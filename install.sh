#!/usr/bin/env bash
# Dotfiles installer for macOS and Linux (dnf, apt, pacman).
# Usage: ./install.sh            install packages + link configs
#        ./install.sh --link     only link configs, skip packages
set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP="$HOME/.dotfiles-backup/$(date +%Y%m%d-%H%M%S)"
OS="$(uname -s)"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- packages

install_packages() {
  case "$OS" in
    Darwin)
      if ! have brew; then
        info "Installing Homebrew"
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
      fi
      info "Installing packages with brew"
      brew install git neovim fish tmux starship ripgrep fd fzf lazygit gh htop curl unzip
      brew install --cask font-jetbrains-mono-nerd-font font-symbols-only-nerd-font || true
      ;;
    Linux)
      if have dnf; then
        info "Installing packages with dnf"
        sudo dnf install -y git neovim fish tmux ripgrep fd-find fzf gh htop curl unzip gcc make
        sudo dnf copr enable -y atim/lazygit && sudo dnf install -y lazygit || warn "lazygit skipped"
      elif have apt-get; then
        info "Installing packages with apt"
        sudo apt-get update
        sudo apt-get install -y git fish tmux ripgrep fd-find fzf gh htop curl unzip build-essential
        install_neovim_tarball
        have lazygit || sudo apt-get install -y lazygit || warn "lazygit skipped"
      elif have pacman; then
        info "Installing packages with pacman"
        sudo pacman -Syu --needed --noconfirm git neovim fish tmux starship ripgrep fd fzf lazygit github-cli htop curl unzip base-devel
      else
        warn "Unknown package manager, install packages yourself"
      fi
      have starship || { info "Installing starship"; curl -sS https://starship.rs/install.sh | sh -s -- -y; }
      install_nerd_fonts
      ;;
    *)
      warn "Unsupported OS: $OS"
      ;;
  esac

  if [ ! -d "$HOME/.tmux/plugins/tpm" ]; then
    info "Installing tmux plugin manager"
    git clone --depth 1 https://github.com/tmux-plugins/tpm "$HOME/.tmux/plugins/tpm"
  fi
}

# apt ships an old neovim; LazyVim needs >= 0.9
install_neovim_tarball() {
  if have nvim && nvim --version | head -1 | grep -qE 'v0\.(1[0-9]|9)|v[1-9]'; then return; fi
  info "Installing latest neovim to /opt/nvim"
  local arch; arch="$(uname -m)"; [ "$arch" = "aarch64" ] && arch="arm64"
  local tmp; tmp="$(mktemp -d)"
  curl -fsSL "https://github.com/neovim/neovim/releases/latest/download/nvim-linux-${arch}.tar.gz" -o "$tmp/nvim.tgz"
  sudo rm -rf /opt/nvim && sudo mkdir -p /opt/nvim
  sudo tar -xzf "$tmp/nvim.tgz" -C /opt/nvim --strip-components=1
  sudo ln -sf /opt/nvim/bin/nvim /usr/local/bin/nvim
  rm -rf "$tmp"
}

install_nerd_fonts() {
  local dir="$HOME/.local/share/fonts"
  if fc-list 2>/dev/null | grep -qi "JetBrainsMono Nerd"; then return; fi
  info "Installing JetBrainsMono + Symbols Nerd Fonts"
  mkdir -p "$dir"
  local tmp; tmp="$(mktemp -d)"
  for font in JetBrainsMono NerdFontsSymbolsOnly; do
    curl -fsSL "https://github.com/ryanoasis/nerd-fonts/releases/latest/download/${font}.zip" -o "$tmp/$font.zip"
    unzip -oq "$tmp/$font.zip" -d "$dir/$font"
  done
  rm -rf "$tmp"
  have fc-cache && fc-cache -f "$dir" >/dev/null
}

# ---------------------------------------------------------------- linking

link() {
  local src="$1" dst="$2"
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then return; fi
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    mkdir -p "$BACKUP/$(dirname "${dst#"$HOME"/}")"
    mv "$dst" "$BACKUP/${dst#"$HOME"/}"
    warn "Backed up $dst -> $BACKUP/${dst#"$HOME"/}"
  fi
  mkdir -p "$(dirname "$dst")"
  ln -s "$src" "$dst"
  info "Linked $dst"
}

link_configs() {
  # ~/.config/*
  for item in "$DOTFILES"/config/*; do
    link "$item" "$HOME/.config/$(basename "$item")"
  done
  # ~/.* (files at home root)
  for item in "$DOTFILES"/home/.[!.]*; do
    local name; name="$(basename "$item")"
    if [ "$name" = ".tmux" ]; then
      # link the scripts only, so tpm plugins stay out of the repo
      mkdir -p "$HOME/.tmux"
      for f in "$item"/*; do link "$f" "$HOME/.tmux/$(basename "$f")"; done
    else
      link "$item" "$HOME/$name"
    fi
  done
}

set_default_shell() {
  have fish || return 0
  local fish_path; fish_path="$(command -v fish)"
  [ "${SHELL:-}" = "$fish_path" ] && return 0
  grep -qxF "$fish_path" /etc/shells || echo "$fish_path" | sudo tee -a /etc/shells >/dev/null
  info "Setting fish as default shell"
  chsh -s "$fish_path" || warn "chsh failed, run: chsh -s $fish_path"
}

# ---------------------------------------------------------------- main

if [ "${1:-}" != "--link" ]; then
  install_packages
fi
link_configs
set_default_shell

info "Done. Open nvim to let LazyVim install plugins; in tmux press prefix (C-p) + I for tpm plugins."
