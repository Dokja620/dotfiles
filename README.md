# dotfiles

My setup: LazyVim, fish, starship, tmux, ghostty, kitty, git, htop.

## Install

```sh
git clone https://github.com/Dokja620/dotfiles ~/dotfiles
cd ~/dotfiles
./install.sh          # packages + symlinks
./install.sh --link   # symlinks only
```

Works on macOS (Homebrew) and Linux (dnf, apt, pacman). Existing files get moved to `~/.dotfiles-backup/<timestamp>/` before linking.

## Layout

| Repo path           | Linked to                   |
| ------------------- | --------------------------- |
| `config/nvim`       | `~/.config/nvim` (LazyVim)  |
| `config/fish`       | `~/.config/fish`            |
| `config/starship.toml` | `~/.config/starship.toml` |
| `config/ghostty`    | `~/.config/ghostty`         |
| `config/kitty`      | `~/.config/kitty`           |
| `config/git`        | `~/.config/git`             |
| `config/htop`       | `~/.config/htop`            |
| `home/.tmux.conf`   | `~/.tmux.conf`              |
| `home/.tmux/*.sh`   | `~/.tmux/` (claude status bar scripts) |
| `home/.gitconfig`   | `~/.gitconfig`              |
| `home/.bashrc`      | `~/.bashrc`                 |

## After install

- `nvim` — LazyVim bootstraps plugins on first launch.
- tmux — prefix is `C-p`; press `prefix + I` to install plugins.
- Change `user.email` in `home/.gitconfig` if you're not me.
