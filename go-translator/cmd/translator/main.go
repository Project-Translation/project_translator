package main

import (
	"log"
	"os"
)

const version = "1.0.0"

func main() {
	// 设置日志
	log.SetFlags(0)
	if os.Getenv("TRANSLATOR_DEBUG") == "1" {
		log.SetFlags(log.LstdFlags | log.Lshortfile)
	}

	// 创建并运行根命令
	rootCmd := NewRootCommand()
	if err := rootCmd.Run(os.Args[1:]); err != nil {
		log.Fatalf("错误: %v", err)
		os.Exit(1)
	}
}
