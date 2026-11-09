import { app } from './app.js'
import { prisma } from './db.js'

const port = Number(process.env.PORT ?? 4000)
const server = app.listen(port, () => {
  console.info(`ShopSmart API listening on port ${port}`)
})

async function shutdown(signal: string) {
  console.info(`Received ${signal}; shutting down`)
  server.close(async (error) => {
    await prisma.$disconnect()
    if (error) {
      console.error('HTTP server shutdown failed', error)
      process.exitCode = 1
    }
  })
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
