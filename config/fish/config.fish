starship init fish | source
set fish_greeting

if status is-interactive
    # Commands to run in interactive sessions can go here
end

# bun
set --export BUN_INSTALL "$HOME/.bun"
set --export PATH $BUN_INSTALL/bin $PATH

# opencode
fish_add_path $HOME/.opencode/bin
export PATH="$HOME/.local/bin:$PATH"
