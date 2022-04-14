import { Injectable, ConsoleLogger, Scope } from '@nestjs/common';

const COLOR_ON = '\x1B[32m';
const COLOR_OFF = '\x1B[39m';
@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService extends ConsoleLogger {
  color(text: string) {
    return process.env.NO_COLOR ? text : `${COLOR_ON}${text}${COLOR_OFF}`;
  }

  json(logObj: Record<string, any>) {
    const message = JSON.stringify(
      { context: this.context, timestamp: new Date().toISOString(), message: logObj },
      null,
      2,
    );
    process.stdout.write(`${this.color(message)}\n`);
  }
}
