#!/usr/bin/env node

const config = require('../config');
const { runMigrations } = require('./migrate');

runMigrations(config.db)
  .then((count) => {
    console.log(`Database migrations are current (${count} known).`);
  })
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
