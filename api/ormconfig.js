// Used for migrations. See app module for application db connection
module.exports = [
  {
    type: 'postgres',
    schema: 'quickstart_api',
    host: process.env.PGHOST,
    port: +process.env.PGPORT,
    username: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    entities: ['dist/**/*.entity.js'],
    migrations: ['dist/migrations/*.js'],
    cli: {
      migrationsDir: 'src/migrations',
    },
    synchronize: false,
  },
];
