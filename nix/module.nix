{ self, ... }:
{
  flake.nixosModules.default =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.services.heimdall;
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
            Host name of a Caddy virtual host for heimdall. Caddy serves the web app from its
            files, with long-lived caching for hashed assets, content-hash ETags, and security
            headers, and proxies only /api to the server. TLS directives for the host can go
            in `services.caddy.virtualHosts.<host>.extraConfig`, which is merged with this.
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
        services.caddy = lib.mkIf (cfg.virtualHost != null) {
          enable = lib.mkDefault true;
          virtualHosts.${cfg.virtualHost}.extraConfig = ''
            import ${cfg.package}/share/heimdall/heimdall.caddy ${cfg.package.web} ${cfg.listen}
          '';
        };

        assertions = [
          {
            assertion = lib.hasPrefix "/var/lib/" cfg.dataDir;
            message = "services.heimdall.dataDir must be under /var/lib/.";
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

  # Boots a VM with the module, then logs in, syncs, restarts, and syncs again; then goes
  # through the Caddy virtual host.
  perSystem =
    {
      pkgs,
      lib,
      self',
      ...
    }:
    {
      checks = lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
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
