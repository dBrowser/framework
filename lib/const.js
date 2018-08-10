const bytes = require('bytes')
const ms = require('ms')

// file paths
exports.TRACKER_DATA_FILE = 'analytics-ping.json'
exports.TRACKER_SERVER = 'reports.dbrowser.io'
exports.TRACKER_CHECKIN_INTERVAL = ms('1w')

// 64 char hex
exports.DWEB_HASH_REGEX = /^[0-9a-f]{64}$/i
exports.DWEB_URL_REGEX = /^(?:dweb:\/\/)?([0-9a-f]{64})/i

// url file paths
exports.DWEB_VALID_PATH_REGEX = /^[a-z0-9\-._~!$&'()*+,;=:@/\s]+$/i
exports.INVALID_SAVE_FOLDER_CHAR_REGEX = /[^0-9a-zA-Z-_ ]/g

// dweb settings
exports.DWEB_FLOCK_PORT = 6620
exports.DWEB_MANIFEST_FILENAME = 'dweb.json'
let quotaEnvVar = process.env.DBROWSER_DWEB_QUOTA_DEFAULT_BYTES_ALLOWED || process.env.dbrowser_dweb_quota_default_bytes_allowed
exports.DWEB_QUOTA_DEFAULT_BYTES_ALLOWED = bytes.parse(quotaEnvVar || '500mb')
exports.DEFAULT_DWEB_DNS_TTL = ms('1h')
exports.MAX_DWEB_DNS_TTL = ms('7d')
exports.DEFAULT_DWEB_API_TIMEOUT = ms('5s')
exports.DWEB_GC_EXPIRATION_AGE = ms('7d') // how old do vaults need to be before deleting them from the cache?
exports.DWEB_GC_FIRST_COLLECT_WAIT = ms('30s') // how long after process start to do first collect?
exports.DWEB_GC_REGULAR_COLLECT_WAIT = ms('15m') // how long between GCs to collect?
// dweb.json manifest fields which can be changed by configure()
exports.DWEB_CONFIGURABLE_FIELDS = [
  'title',
  'description',
  'links',
  'web_root',
  'fallback_page'
]
// dweb.json manifest fields which should be preserved in forks
exports.DWEB_PRESERVED_FIELDS_ON_FORK = [
  'web_root',
  'fallback_page',
  'links'
]

// workspace settings
exports.WORKSPACE_VALID_NAME_REGEX = /^[a-z][a-z0-9-]*$/i

// git-url validator
exports.IS_GIT_URL_REGEX = /(?:git|ssh|https?|git@[-\w.]+):(\/\/)?(.*?)(\.git)(\/?|\#[-\d\w._]+?)$/

// vault metadata
// TODO- these may not all be meaningful anymore -prf
exports.STANDARD_VAULT_TYPES = [
  'application',
  'module',
  'dataset',
  'documents',
  'music',
  'photos',
  'user-profile',
  'videos',
  'website'
]
