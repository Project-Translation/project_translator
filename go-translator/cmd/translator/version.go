package main

// 通过构建参数注入（例如：-ldflags "-X main.Version=1.2.3"）。
// 默认值用于本地开发构建。
var Version = "dev"

