import { log as Logger } from '@zos/utils'

const logger = Logger.getLogger('bikehud')

App({
  globalData: {},

  onCreate() {
    logger.debug('app onCreate')
  },

  onDestroy() {
    logger.debug('app onDestroy')
  },
})
