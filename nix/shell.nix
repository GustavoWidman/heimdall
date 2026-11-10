{ fenix, ... }:
{
  perSystem =
    { pkgs, system, ... }:
    let
      toolchain = fenix.packages.${system}.fromToolchainFile {
        file = ../rust-toolchain.toml;
        sha256 = "sha256-Ya1861La/Q70m/4KN5JZ0lhwOehAmGAhxJ3wCGQODSM=";
      };
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
      };
    };
}
