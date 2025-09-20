export const dbConfig = {
  // Railway provides PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
  // Fall back to POSTGRES_* variables for local development
  host: process.env.PGHOST || process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.PGPORT || process.env.POSTGRES_PORT || '5432'),
  database: process.env.PGDATABASE || process.env.POSTGRES_DB || 'myapp',
  user: process.env.PGUSER || process.env.POSTGRES_USER || 'devuser',
  password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'devpassword',
  
  // Railway provides DATABASE_URL which Prisma uses directly
  connectionString: process.env.DATABASE_URL,
};