{ self, nixpkgs, ... }:
{
  flake.nixosModules.default =
    {
      config,
      lib,
      options,
      pkgs,
      ...
    }:
    let
      cfg = config.services.heimdall;
      web = cfg.package.web;

      # heimdall.caddy as an upstreamer virtual host.
      upstreamerHost = {
        # Site headers go on every response of the host, proxied and error ones included.
        headers = {
          Server = null;
          X-Content-Type-Options = "nosniff";
          X-Frame-Options = "DENY";
          Referrer-Policy = "no-referrer";
          Permissions-Policy = "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()";
          Cross-Origin-Opener-Policy = "same-origin";
        };

        routes = [
          {
            # upstreamer keeps Host and sets X-Forwarded-Proto for heimdall's same-origin
            # check, and writes each event of /api/live as it arrives. No encode here: the
            # server compresses /api/sync itself.
            name = "api";
            when.path = "/api/*";
            proxy = "http://${cfg.listen}";
          }
          {
            # Hashed build assets never change.
            name = "immutable";
            when.path = "/_app/immutable/*";
            routes = [
              { headers.Cache-Control = "public, max-age=31536000, immutable"; }
              {
                files = {
                  root = "${web}";
                  precompressed = [
                    "br"
                    "gzip"
                  ];
                };
              }
            ];
          }
          # Everything else, index.html and the service worker first of all, is revalidated on
          # every load so a deploy reaches clients. The build writes a content-hash ETag beside
          # each file, since every file in the Nix store has the same mtime; Last-Modified would
          # lie.
          {
            headers = {
              Cache-Control = "no-cache";
              Last-Modified = null;
            };
          }
          { requestHeaders.If-Modified-Since = null; }
          {
            # The sidecars are read in place of a file, never served as one.
            name = "sidecar";
            when.path = [
              "*.etag"
              "*.br"
              "*.gz"
            ];
            error = 404;
          }
          {
            # Client routes deep-link to the app; a missing asset under /_app stays a 404.
            name = "client-route";
            when.none = [
              { path = "/_app/*"; }
              {
                file = {
                  root = "${web}";
                  paths = [ "{path}" ];
                };
              }
            ];
            rewrite = "/index.html";
          }
          {
            files = {
              root = "${web}";
              precompressed = [
                "br"
                "gzip"
              ];
              etagSidecar = ".etag";
            };
          }
        ];
      };
    in
    {
      options.services.heimdall = {
        enable = lib.mkEnableOption "heimdall, the sync server and web app";

        package = lib.mkOption {
          type = lib.types.package;
          default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
          defaultText = lib.literalExpression "heimdall.packages.\${system}.default";
          description = ''
            The heimdall package, with the web app it serves as `passthru.web` and the Caddy
            snippet in `share/heimdall/heimdall.caddy`.
          '';
        };

        listen = lib.mkOption {
          type = lib.types.str;
          default = "127.0.0.1:7979";
          description = ''
            Address and port to listen on. heimdall speaks plain http; put a reverse proxy
            that terminates TLS in front of it.
          '';
        };

        dataDir = lib.mkOption {
          type = lib.types.str;
          default = "/var/lib/heimdall";
          description = ''
            Directory holding the database. It must be under /var/lib, where systemd
            creates it as the service's state directory.
          '';
        };

        virtualHost = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          default = null;
          example = "heimdall.example.com";
          description = ''
            Host name of a virtual host for heimdall on the reverse proxy `proxy` names. The
            proxy serves the web app from its files, with long-lived caching for hashed assets,
            content-hash ETags, and security headers, and proxies only /api to the server.
            The host's TLS is set on the proxy's own virtual host, which is merged with this:
            `services.caddy.virtualHosts.<host>.extraConfig` for Caddy,
            `services.upstreamer.virtualHosts.<host>.tls` for upstreamer.
          '';
        };

        proxy = lib.mkOption {
          type = lib.types.enum [
            "caddy"
            "upstreamer"
          ];
          default = "caddy";
          description = ''
            The reverse proxy that serves `virtualHost`: Caddy through `services.caddy`, or
            upstreamer through `services.upstreamer`, which needs upstreamer's NixOS module
            imported on the host.
          '';
        };

        passwordHashFile = lib.mkOption {
          type = lib.types.str;
          example = "/run/agenix/heimdall-password-hash";
          description = ''
            File holding the argon2id PHC string printed by `heimdall hash-password`. It is
            passed to the service as a systemd credential, so it may be readable by root
            only. Keep it out of the Nix store, for example with agenix or sops-nix.
          '';
        };
      };

      config = lib.mkIf cfg.enable {
        services = {
          caddy = lib.mkIf (cfg.virtualHost != null && cfg.proxy == "caddy") {
            enable = lib.mkDefault true;
            virtualHosts.${cfg.virtualHost}.extraConfig = ''
              import ${cfg.package}/share/heimdall/heimdall.caddy ${cfg.package.web} ${cfg.listen}
            '';
          };
        }
        # Without upstreamer's module, services.upstreamer is not an option, and even a
        # disabled definition of it would fail evaluation.
        // lib.optionalAttrs (options ? services.upstreamer) {
          upstreamer = lib.mkIf (cfg.virtualHost != null && cfg.proxy == "upstreamer") {
            enable = lib.mkDefault true;
            virtualHosts.${cfg.virtualHost} = upstreamerHost;
          };
        };

        assertions = [
          {
            assertion = lib.hasPrefix "/var/lib/" cfg.dataDir;
            message = "services.heimdall.dataDir must be under /var/lib/.";
          }
          {
            assertion = cfg.proxy == "upstreamer" -> options ? services.upstreamer;
            message = ''services.heimdall.proxy = "upstreamer" needs upstreamer's NixOS module (services.upstreamer).'';
          }
        ];

        systemd.services.heimdall = {
          description = "heimdall sync server";
          wantedBy = [ "multi-user.target" ];
          after = [ "network.target" ];

          serviceConfig = {
            ExecStart = lib.escapeShellArgs [
              (lib.getExe cfg.package)
              "--listen"
              cfg.listen
              "--data-dir"
              cfg.dataDir
              "--password-hash-file"
              "%d/password-hash"
            ];
            LoadCredential = "password-hash:${cfg.passwordHashFile}";
            Restart = "on-failure";
            RestartSec = "5s";

            DynamicUser = true;
            StateDirectory = lib.removePrefix "/var/lib/" cfg.dataDir;
            StateDirectoryMode = "0700";
            UMask = "0077";

            CapabilityBoundingSet = "";
            DevicePolicy = "closed";
            LockPersonality = true;
            MemoryDenyWriteExecute = true;
            NoNewPrivileges = true;
            PrivateDevices = true;
            PrivateTmp = true;
            PrivateUsers = true;
            ProcSubset = "pid";
            ProtectClock = true;
            ProtectControlGroups = true;
            ProtectHome = true;
            ProtectHostname = true;
            ProtectKernelLogs = true;
            ProtectKernelModules = true;
            ProtectKernelTunables = true;
            ProtectProc = "invisible";
            ProtectSystem = "strict";
            RemoveIPC = true;
            RestrictAddressFamilies = [
              "AF_INET"
              "AF_INET6"
              "AF_UNIX"
            ];
            RestrictNamespaces = true;
            RestrictRealtime = true;
            RestrictSUIDSGID = true;
            SystemCallArchitectures = "native";
            SystemCallFilter = [
              "@system-service"
              "~@privileged"
              "~@resources"
            ];
          };
        };
      };
    };

  perSystem =
    {
      pkgs,
      lib,
      self',
      ...
    }:
    let
      # A host with heimdall behind a virtual host, evaluated but never built: the package is
      # a stand-in, since only the proxy configuration is read.
      package = {
        type = "derivation";
        name = "heimdall";
        outPath = "/nix/store/heimdall";
        web = "/nix/store/heimdall-web";
      };
      host =
        proxy: modules:
        (nixpkgs.lib.nixosSystem {
          modules = [
            self.nixosModules.default
            {
              boot.isContainer = true;
              system.stateVersion = lib.trivial.release;
              nixpkgs.hostPlatform = "x86_64-linux";
              services.heimdall = {
                enable = true;
                inherit package;
                virtualHost = "heimdall.example.com";
                passwordHashFile = "/run/heimdall-password-hash";
              }
              // lib.optionalAttrs (proxy != null) { inherit proxy; };
            }
          ]
          ++ modules;
        }).config;

      # The options of upstreamer's module that heimdall's sets, typed as upstreamer types them.
      upstreamer =
        { lib, ... }:
        {
          options.services.upstreamer = {
            enable = lib.mkEnableOption "upstreamer";
            virtualHosts = lib.mkOption {
              default = { };
              type = lib.types.attrsOf (
                lib.types.submodule {
                  options.headers = lib.mkOption {
                    type = lib.types.attrsOf (lib.types.nullOr lib.types.str);
                    default = { };
                  };
                  options.routes = lib.mkOption {
                    type = lib.types.listOf (pkgs.formats.json { }).type;
                    default = [ ];
                  };
                }
              );
            };
          };
        };

      failed = config: map (a: a.message) (lib.filter (a: !a.assertion) config.assertions);
      caddyServes =
        config:
        config.services.caddy.enable
        &&
          config.services.caddy.virtualHosts."heimdall.example.com".extraConfig == ''
            import /nix/store/heimdall/share/heimdall/heimdall.caddy /nix/store/heimdall-web 127.0.0.1:7979
          '';

      # Every value of a `root` field, at any depth.
      roots =
        value:
        if lib.isAttrs value then
          lib.optional (value ? root) value.root ++ lib.concatMap roots (lib.attrValues value)
        else if lib.isList value then
          lib.concatMap roots value
        else
          [ ];

      viaCaddy = host null [ upstreamer ];
      viaCaddyAlone = host null [ ];
      viaUpstreamer = host "upstreamer" [ upstreamer ];
      viaUpstreamerAlone = host "upstreamer" [ ];
      emitted = viaUpstreamer.services.upstreamer.virtualHosts."heimdall.example.com";

      expectations = {
        "Caddy serves the host by default" = caddyServes viaCaddy && failed viaCaddy == [ ];
        "a host without upstreamer's module evaluates as before" =
          caddyServes viaCaddyAlone && failed viaCaddyAlone == [ ];
        "upstreamer stays off by default" =
          !viaCaddy.services.upstreamer.enable && viaCaddy.services.upstreamer.virtualHosts == { };
        "upstreamer serves the host when chosen" =
          viaUpstreamer.services.upstreamer.enable && failed viaUpstreamer == [ ];
        "Caddy stays off when upstreamer is chosen" =
          !viaUpstreamer.services.caddy.enable && viaUpstreamer.services.caddy.virtualHosts == { };
        "upstreamer proxies /api to the server" = lib.any (
          r: r.proxy or null == "http://127.0.0.1:7979"
        ) emitted.routes;
        "upstreamer reads files from the web build only" =
          lib.unique (roots emitted.routes) == [ "/nix/store/heimdall-web" ];
        "upstreamer sets the security headers" = emitted.headers.X-Frame-Options == "DENY";
        "choosing upstreamer without its module fails an assertion" =
          lib.any (lib.hasInfix "services.upstreamer") (failed viaUpstreamerAlone);
      };
      unmet = lib.attrNames (lib.filterAttrs (_: ok: !ok) expectations);
    in
    {
      checks = {
        # Evaluates the module with each proxy, and keeps the virtual host it gives upstreamer.
        heimdall-proxy =
          if unmet == [ ] then
            pkgs.writeText "heimdall-upstreamer-host.json" (builtins.toJSON emitted)
          else
            throw "heimdall-proxy: ${lib.concatStringsSep "; " unmet}";
      }
      // lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
        # Boots a VM with the module, then logs in, syncs, restarts, and syncs again; then goes
        # through the Caddy virtual host.
        heimdall-module = pkgs.testers.runNixOSTest {
          name = "heimdall-module";
          nodes.machine = {
            imports = [ self.nixosModules.default ];
            environment.systemPackages = [ pkgs.curl ];
            services.heimdall = {
              enable = true;
              package = self'.packages.heimdall;
              virtualHost = "http://localhost:8080";
              passwordHashFile = toString (
                pkgs.runCommand "heimdall-test-password-hash" { } ''
                  echo hunter2 | ${lib.getExe self'.packages.heimdall} hash-password > $out
                ''
              );
            };
          };
          testScript = ''
            import json

            base = "http://127.0.0.1:7979"
            machine.wait_for_unit("heimdall.service")
            machine.wait_for_open_port(7979)
            machine.succeed(f"curl -sf {base}/api/health")

            headers = machine.succeed(
                f"curl -sf -D - -o /dev/null -H 'content-type: application/json' "
                f"-d '{{\"password\":\"hunter2\"}}' {base}/api/login"
            )
            cookie = next(
                line.split(":", 1)[1].split(";")[0].strip()
                for line in headers.splitlines()
                if line.lower().startswith("set-cookie:")
            )

            def sync(body):
                return json.loads(machine.succeed(
                    f"curl -sf -H 'cookie: {cookie}' -H 'content-type: application/json' "
                    f"-d '{body}' {base}/api/sync"
                ))

            op = '{"hlc":"0000lkx9a0001a1b2c3d4e5","kind":"mark","id":"m_1","set":{"at":1}}'
            first = sync('{"after":0,"ops":[' + op + ']}')
            assert first["head"] == 1, first

            machine.systemctl("restart heimdall.service")
            machine.wait_for_open_port(7979)
            again = sync('{"after":0,"ops":[]}')
            assert again["epoch"] == first["epoch"], "the epoch survives a restart"
            assert again["ops"] == [{"seq": 1, "op": json.loads(op)}], again

            machine.succeed(f"curl -sf {base}/day/2026-11-09 | grep -q '<html'")

            caddy = "http://localhost:8080"
            machine.wait_for_unit("caddy.service")
            machine.wait_for_open_port(8080)
            machine.succeed(f"curl -sf {caddy}/api/health")
            again = json.loads(machine.succeed(
                f"curl -sf -H 'cookie: {cookie}' -H 'content-type: application/json' "
                f"-d '{{\"after\":0,\"ops\":[]}}' {caddy}/api/sync"
            ))
            assert again["epoch"] == first["epoch"], again

            raw = machine.succeed(f"curl -sf -D - -o /dev/null -H 'accept-encoding: br' {caddy}/day/2026-11-09")
            index = raw.lower()
            assert "cache-control: no-cache" in index, index
            assert "content-encoding: br" in index, index
            assert "x-content-type-options: nosniff" in index, index
            # ETags compare byte for byte, so read it before lowercasing.
            etag = next(l.split(":", 1)[1].strip() for l in raw.splitlines() if l.lower().startswith("etag:"))
            assert len(etag) == 26 and etag.startswith('"'), f"a content-hash ETag: {etag}"
            unchanged = machine.succeed(
                f"curl -s -o /dev/null -w '%{{http_code}}' -H 'accept-encoding: br' "
                f"-H 'if-none-match: {etag}' {caddy}/"
            )
            assert unchanged == "304", unchanged

            asset = machine.succeed(
                "find ${self'.packages.heimdall.web}/_app/immutable -name '*.js' -print -quit"
            ).strip().removeprefix("${self'.packages.heimdall.web}")
            headers = machine.succeed(f"curl -sf -D - -o /dev/null {caddy}{asset}").lower()
            assert "max-age=31536000, immutable" in headers, headers
            machine.fail(f"curl -sf {caddy}/_app/immutable/missing.js")
            machine.fail(f"curl -sf {caddy}/index.html.etag")
          '';
        };
      };
    };
}
