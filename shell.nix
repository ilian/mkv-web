let
  nixpkgs = (builtins.fetchTarball https://github.com/NixOS/nixpkgs/archive/release-21.05.tar.gz);
in

with import nixpkgs {};

pkgs.mkShell {
  nativeBuildInputs = [
    yarn
  ];
}
