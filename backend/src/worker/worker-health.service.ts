import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";

@Injectable()
export class WorkerHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerHealthService.name);
  private timer?: NodeJS.Timeout;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.pingDatabase();
    }, 30_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async pingDatabase(): Promise<void> {
    try {
      await this.dataSource.query("SELECT 1");
      this.logger.debug("Worker database heartbeat ok");
    } catch (error) {
      this.logger.warn(
        `Worker database heartbeat failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}