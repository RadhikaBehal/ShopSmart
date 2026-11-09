import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'

dotenv.config({ path: process.env.ENV_FILE ?? fileURLToPath(new URL('../../../.env', import.meta.url)) })
process.env.RUN_DATABASE_INTEGRATION_TESTS = '1'
