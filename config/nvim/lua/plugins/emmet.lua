return {
  "neovim/nvim-lspconfig",
  opts = {
    servers = {
      emmet_ls = {
        filetypes = {
          "html",
          "css",
          "php", -- ✅ Add PHP here
          "blade", -- if you're using Laravel Blade
        },
        init_options = {
          html = {
            options = {
              ["bem.enabled"] = true,
            },
          },
        },
      },
    },
  },
}
