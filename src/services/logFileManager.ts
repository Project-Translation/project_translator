import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LogFileConfig } from "../config/config";

/**
 * LogFileManager handles writing debug logs to files when debug mode is enabled
 * Features:
 * - Automatic log file rotation based on size
 * - Configurable maximum file size and number of files to keep
 * - Thread-safe writing with queue mechanism
 * - Automatic directory creation
 */
export class LogFileManager {
    private config: LogFileConfig;
    private logDir: string;
    private currentLogFile: string;
    private writeQueue: string[] = [];
    private isWriting = false;
    private logDirEnsured = false;

	    constructor(config: LogFileConfig, workspaceRoot?: string) {
        this.config = {
            enabled: config.enabled,
            maxSizeKB: config.maxSizeKB || 10240, // 10MB default
            maxFiles: config.maxFiles || 5,
            path: config.path
        };

        // Determine log directory
        if (this.config.path && path.isAbsolute(this.config.path)) {
            this.logDir = this.config.path;
        } else if (this.config.path) {
            // Relative path, resolve against workspace root
            this.logDir = workspaceRoot ? path.resolve(workspaceRoot, this.config.path) : path.resolve(this.config.path);
        } else {
            // Default: .translation-logs in workspace root
            this.logDir = workspaceRoot ? path.join(workspaceRoot, ".translation-logs") : path.resolve(".translation-logs");
        }

	        this.currentLogFile = path.join(this.logDir, "debug.log");
    }

    /**
     * Ensure log directory exists.
     * 注意：不要在构造函数/配置更新时创建目录，避免用户“只改设置”就产生文件系统副作用。
     * 我们只在真正写入日志时创建目录/文件。
     */
    private ensureLogDirectoryOnce(): void {
        if (this.logDirEnsured) {
            return;
        }
        try {
            fs.mkdirSync(this.logDir, { recursive: true });
            this.logDirEnsured = true;
        } catch (error) {
            console.error("Failed to create log directory:", error);
        }
    }

    /**
     * Write a log message to file if logging is enabled
     */
    public writeLog(message: string): void {
        if (!this.config.enabled) {
            return;
        }

        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n`;
        
        // Add to queue for thread-safe writing
        this.writeQueue.push(logEntry);
        this.processQueue();
    }

    /**
     * Process the write queue
     */
    private async processQueue(): Promise<void> {
        if (this.isWriting || this.writeQueue.length === 0) {
            return;
        }

        this.isWriting = true;

        try {
            while (this.writeQueue.length > 0) {
                const entry = this.writeQueue.shift()!;
                await this.writeToFile(entry);
            }
        } catch (error) {
            console.error("Error writing to log file:", error);
        } finally {
            this.isWriting = false;
        }
    }

    /**
     * Write entry to file with rotation check
     */
	    private async writeToFile(entry: string): Promise<void> {
	        try {
                this.ensureLogDirectoryOnce();
	            // Check if rotation is needed
	            await this.checkAndRotateLog();
	
	            // Append to current log file（异步，避免阻塞）
	            await fs.promises.appendFile(this.currentLogFile, entry, "utf-8");
        } catch (error) {
            console.error("Failed to write log entry:", error);
        }
    }

    /**
     * Check if log rotation is needed and perform rotation
     */
	    private async checkAndRotateLog(): Promise<void> {
	        try {
	            let stats: fs.Stats;
	            try {
	                stats = await fs.promises.stat(this.currentLogFile);
	            } catch {
	                return;
	            }
	
	            const fileSizeKB = stats.size / 1024;
	
	            if (fileSizeKB >= this.config.maxSizeKB!) {
	                await this.rotateLogFiles();
	            }
	        } catch (error) {
	            console.error("Error checking log file size:", error);
	        }
	    }

    /**
     * Rotate log files
     */
	    private async rotateLogFiles(): Promise<void> {
	        try {
                this.ensureLogDirectoryOnce();
	            const maxFiles = this.config.maxFiles!;
	            
	            // Remove oldest log file if we've reached the limit
	            const oldestLogFile = path.join(this.logDir, `debug.${maxFiles - 1}.log`);
	            try {
	                await fs.promises.unlink(oldestLogFile);
	            } catch {
	                // ignore if not exists
	            }
	
	            // Shift existing log files
	            for (let i = maxFiles - 2; i >= 1; i--) {
	                const currentFile = path.join(this.logDir, `debug.${i}.log`);
	                const nextFile = path.join(this.logDir, `debug.${i + 1}.log`);
	                
	                try {
	                    await fs.promises.rename(currentFile, nextFile);
	                } catch {
	                    // ignore if currentFile doesn't exist
	                }
	            }
	
	            // Move current log to debug.1.log
	            const firstRotatedFile = path.join(this.logDir, "debug.1.log");
	            try {
	                await fs.promises.rename(this.currentLogFile, firstRotatedFile);
	            } catch {
	                // ignore if current log file doesn't exist
	            }
	
	            // Create new current log file
	            await fs.promises.writeFile(this.currentLogFile, "", "utf-8");
	        } catch (error) {
	            console.error("Error rotating log files:", error);
	        }
	    }

	    /**
	     * Ensure log directory exists（保留兼容：不再在构造时调用）
	     */
	    private ensureLogDirectory(): void {
            this.ensureLogDirectoryOnce();
	    }

    /**
     * Get the current log file path
     */
    public getCurrentLogFile(): string {
        return this.currentLogFile;
    }

    /**
     * Get the log directory path
     */
    public getLogDirectory(): string {
        return this.logDir;
    }

    /**
     * Clean up resources
     */
    public dispose(): void {
        // Process any remaining queue items
        if (this.writeQueue.length > 0) {
            this.processQueue();
        }
    }

    /**
     * Update configuration
     */
    public updateConfig(config: LogFileConfig, workspaceRoot?: string): void {
        const oldLogDir = this.logDir;
        
        this.config = {
            enabled: config.enabled,
            maxSizeKB: config.maxSizeKB || 10240,
            maxFiles: config.maxFiles || 5,
            path: config.path
        };

        // Recalculate log directory if path changed
        if (this.config.path && path.isAbsolute(this.config.path)) {
            this.logDir = this.config.path;
        } else if (this.config.path) {
            this.logDir = workspaceRoot ? path.resolve(workspaceRoot, this.config.path) : path.resolve(this.config.path);
        } else {
            this.logDir = workspaceRoot ? path.join(workspaceRoot, ".translation-logs") : path.resolve(".translation-logs");
        }

        // Update current log file path if directory changed
        if (oldLogDir !== this.logDir) {
            this.currentLogFile = path.join(this.logDir, "debug.log");
            // 仅更新路径，不在这里创建目录；目录会在首次写入时创建
            this.logDirEnsured = false;
        }
    }
}
