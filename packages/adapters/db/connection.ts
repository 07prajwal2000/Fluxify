export enum DbType {
  POSTGRES = "pg",
  MONGODB = "mongo",
  MYSQL = "mysql",
}

export interface Connection {
  dbType: DbType;
  username: string;
  password: string;
  host: string;
  port: string | number;
  database: string;
  ssl?: boolean;
}
