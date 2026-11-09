// Journal du service : une ligne JSON par événement sur la sortie standard (lisible avec `docker compose logs detection`).

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

function write(level: 'info' | 'warn' | 'error', message: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, service: 'detection', message, ...fields });
  if (level === 'info') console.log(line);
  else console.error(line);
}

export const jsonLogger: Logger = {
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields),
};

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
