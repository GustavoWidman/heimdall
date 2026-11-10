{
  crane,
  fenix,
  bun2nix,
  ...
}:
{
  perSystem =
    {
      pkgs,
      lib,
      system,
      ...
    }:
    let
      toolchain = import ./toolchain.nix { inherit fenix pkgs; };
      craneLib = (crane.mkLib pkgs).overrideToolchain toolchain;
      bunLib = bun2nix.packages.${system}.default;
      root = ../.;
      cargoSources = craneLib.fileset.commonCargoSources root;

      args = {
        src = lib.fileset.toSource {
          inherit root;
          fileset = lib.fileset.unions [
            cargoSources
            ../.rustfmt.toml
            # The server tests read the shared wire fixture.
            ../contract/sync.json
          ];
        };
        strictDeps = true;
      };

      # The dependency build sees heimdall itself at version 0.0.0: the manifest loses its
      # version and the lockfile's own entry is rewritten to match. Every release bumps the
      # version, and without this each bump would rebuild every dependency instead of
      # fetching them from the binary cache.
      ownVersion = (lib.importTOML ../Cargo.toml).package.version;
      depsLock =
        let
          lock = builtins.unsafeDiscardStringContext (builtins.readFile ../Cargo.lock);
          entry = version: "name = \"heimdall\"\nversion = \"${version}\"\n";
        in
        assert lib.hasInfix (entry ownVersion) lock;
        builtins.toFile "Cargo.lock" (
          builtins.replaceStrings [ (entry ownVersion) ] [ (entry "0.0.0") ] lock
        );
      cargoArtifacts = craneLib.buildDepsOnly (
        removeAttrs args [ "src" ]
        // {
          pname = "heimdall";
          version = "0.0.0";
          dummySrc = craneLib.mkDummySrc {
            # Without Cargo.lock, which depsLock stands in for.
            src = lib.fileset.toSource {
              inherit root;
              fileset = lib.fileset.difference cargoSources ../Cargo.lock;
            };
            cargoLock = depsLock;
            cleanCargoTomlFilter =
              path: lib.concatStringsSep "." path != "package.version" && craneLib.filters.cargoTomlDefault path;
          };
          cargoVendorDir = craneLib.vendorCargoDeps { inherit (args) src; };
        }
      );

      server = craneLib.buildPackage (
        args
        // {
          inherit cargoArtifacts;
          pname = "heimdall-server";
          # checks.heimdall-test runs the tests.
          doCheck = false;
          meta.mainProgram = "heimdall";
        }
      );

      webFiles = [
        ../web/package.json
        ../web/bun.lock
        ../web/.npmrc
        ../web/tsconfig.json
        ../web/vite.config.ts
        ../web/scripts/compress.ts
        ../web/src
        ../web/static
      ];

      # The SvelteKit static build (adapter-static output), with a .br and .gz beside each
      # text file for the server to send as they are.
      web = bunLib.mkDerivation {
        pname = "heimdall-web";
        version = (lib.importJSON ../web/package.json).version;
        src = lib.fileset.toSource {
          root = ../web;
          fileset = lib.fileset.unions webFiles;
        };

        bunDeps = bunLib.fetchBunDeps { bunNix = ../web/.bun.nix; };
        # The only lifecycle script is `prepare` (svelte-kit sync), which `vite build`
        # runs itself.
        dontRunLifecycleScripts = true;

        buildPhase = ''
          runHook preBuild
          bun --bun run build
          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall
          mkdir -p $out
          cp -r build/. $out/
          runHook postInstall
        '';

        dontFixup = true;
      };

      # The server with --web-dir defaulting to the web app above. The flag and
      # HEIMDALL_WEB_DIR still override it. share/heimdall/heimdall.caddy serves the same
      # files from Caddy, which proxies only /api to the server.
      heimdall =
        pkgs.runCommand "heimdall-${server.version}"
          {
            nativeBuildInputs = [ pkgs.makeBinaryWrapper ];
            passthru = { inherit server web; };
            meta = {
              description = "heimdall: the watchman for your context switches";
              license = lib.licenses.mit;
              mainProgram = "heimdall";
            };
          }
          ''
            makeBinaryWrapper ${lib.getExe server} $out/bin/heimdall \
              --set-default HEIMDALL_WEB_DIR ${web}
            install -Dm644 ${./heimdall.caddy} $out/share/heimdall/heimdall.caddy
          '';
    in
    {
      packages = {
        inherit heimdall;
        heimdall-server = server;
        heimdall-web = web;
        default = heimdall;
      };

      checks = {
        inherit heimdall;
        heimdall-test = craneLib.cargoTest (args // { inherit cargoArtifacts; });
        heimdall-clippy = craneLib.cargoClippy (
          args
          // {
            inherit cargoArtifacts;
            cargoClippyExtraArgs = "--all-targets -- --deny warnings";
          }
        );
        heimdall-fmt = craneLib.cargoFmt { inherit (args) src; };

        # Parses and provisions the Caddy snippet the way the NixOS module imports it.
        heimdall-caddy-config =
          let
            caddyfile = pkgs.writeText "Caddyfile" ''
              {
                admin off
                auto_https off
                persist_config off
              }
              http://heimdall.example {
                import ${heimdall}/share/heimdall/heimdall.caddy ${web} 127.0.0.1:7979
              }
            '';
          in
          pkgs.runCommand "heimdall-caddy-config" { nativeBuildInputs = [ pkgs.caddy ]; } ''
            export HOME=$TMPDIR XDG_DATA_HOME=$TMPDIR XDG_CONFIG_HOME=$TMPDIR
            caddy validate --adapter caddyfile --config ${caddyfile}
            touch $out
          '';

        # Type check and unit tests. The tests read contract/sync.json beside web/.
        heimdall-web-test = bunLib.mkDerivation {
          pname = "heimdall-web-test";
          inherit (web) version bunDeps dontRunLifecycleScripts;
          src = lib.fileset.toSource {
            inherit root;
            fileset = lib.fileset.unions ([ ../contract/sync.json ] ++ webFiles);
          };
          sourceRoot = "source/web";

          buildPhase = ''
            runHook preBuild
            bun --bun run check
            bun --bun run test:unit --run
            runHook postBuild
          '';

          installPhase = "touch $out";
          dontFixup = true;
        };

        # Fails when a route's JS or CSS outgrows its line in web/perf-budget.json.
        heimdall-web-budget = bunLib.mkDerivation {
          pname = "heimdall-web-budget";
          inherit (web) version bunDeps dontRunLifecycleScripts;
          src = lib.fileset.toSource {
            root = ../web;
            fileset = lib.fileset.unions (
              webFiles
              ++ [
                ../web/scripts/budget.ts
                ../web/perf-budget.json
              ]
            );
          };

          buildPhase = ''
            runHook preBuild
            bun --bun run build
            bun --bun scripts/budget.ts
            runHook postBuild
          '';

          installPhase = "touch $out";
          dontFixup = true;
        };
      };
    };
}
