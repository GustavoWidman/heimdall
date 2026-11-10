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

      args = {
        src = lib.fileset.toSource {
          inherit root;
          fileset = lib.fileset.unions [
            (craneLib.fileset.commonCargoSources root)
            ../.rustfmt.toml
            # The server tests read the shared wire fixture.
            ../contract/sync.json
          ];
        };
        strictDeps = true;
      };
      cargoArtifacts = craneLib.buildDepsOnly args;

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

      # The SvelteKit static build (adapter-static output).
      web = bunLib.mkDerivation {
        pname = "heimdall-web";
        version = (lib.importJSON ../web/package.json).version;
        src = lib.fileset.toSource {
          root = ../web;
          fileset = lib.fileset.unions [
            ../web/package.json
            ../web/bun.lock
            ../web/.npmrc
            ../web/tsconfig.json
            ../web/vite.config.ts
            ../web/src
            ../web/static
          ];
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
      # HEIMDALL_WEB_DIR still override it.
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
      };
    };
}
