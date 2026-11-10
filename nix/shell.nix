{ fenix, bun2nix, ... }:
{
  perSystem =
    { pkgs, system, ... }:
    let
      toolchain = import ./toolchain.nix { inherit fenix pkgs; };
    in
    {
      devshells.default = {
        motd = "";
        packages = with pkgs; [
          toolchain
          bun
          sqlite
          watchexec
        ];
        commands = [
          {
            name = "lock-web";
            help = "regenerate web/.bun.nix from web/bun.lock";
            # bun2nix 2.1.2 refuses lockfileVersion 2, although the package layout it reads
            # is the same as in version 1.
            command = ''
              set -eu
              cd "$PRJ_ROOT/web"
              lock=$(mktemp)
              trap 'rm -f "$lock"' EXIT
              sed 's/"lockfileVersion": 2,/"lockfileVersion": 1,/' bun.lock > "$lock"
              ${bun2nix.packages.${system}.default}/bin/bun2nix --lock-file "$lock" --output-file .bun.nix
            '';
          }
        ];
      };
    };
}
