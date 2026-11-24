<?php
/**
 * PrintFlow AutoPrint — Complete cPanel / PHP 8+ Hosting Installer (install.php)
 * Upload the built cPanel package (or index.html + assets/ + install.php) to public_html/
 * and open https://yourdomain.com/install.php in your browser.
 */

declare(strict_types=1);

if (session_status() === PHP_SESSION_NONE) {
    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
        || ((int) ($_SERVER['SERVER_PORT'] ?? 0) === 443);
    session_set_cookie_params([
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => $isHttps,
    ]);
    session_start();
}

define('INSTALLER_VERSION', '2.1.0');
define('BASE_DIR', __DIR__);
define('STORAGE_DIR', BASE_DIR . '/storage');
define('CONFIG_DIR', BASE_DIR . '/config');
define('UPLOAD_DIR', BASE_DIR . '/uploads');
define('API_DIR', BASE_DIR . '/api');
define('LOCK_FILE', STORAGE_DIR . '/install.lock');

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}
$csrfToken = (string) $_SESSION['csrf_token'];

$isLocked = file_exists(LOCK_FILE);

$hasPdoDriver = extension_loaded('pdo') && (extension_loaded('pdo_mysql') || extension_loaded('pdo_sqlite'));
$requirements = [
    [
        'label' => 'PHP Version (>= 8.0 — 8.0 / 8.1 / 8.2 / 8.3 / 8.4+)',
        'ok' => version_compare(PHP_VERSION, '8.0.0', '>='),
        'required' => true,
        'detail' => 'Detected PHP ' . PHP_VERSION,
    ],
    [
        'label' => 'PDO Database Driver (MySQL or SQLite)',
        'ok' => $hasPdoDriver,
        'required' => true,
        'detail' => implode(', ', array_filter([
            extension_loaded('pdo_mysql') ? 'pdo_mysql' : '',
            extension_loaded('pdo_sqlite') ? 'pdo_sqlite' : '',
        ])) ?: 'Missing pdo_mysql / pdo_sqlite',
    ],
    [
        'label' => 'JSON & OpenSSL Extensions',
        'ok' => extension_loaded('json') && extension_loaded('openssl'),
        'required' => true,
        'detail' => (extension_loaded('json') ? 'json OK' : 'json missing') . ' / ' . (extension_loaded('openssl') ? 'openssl OK' : 'openssl missing'),
    ],
    [
        'label' => 'Root Directory Writable',
        'ok' => is_writable(BASE_DIR),
        'required' => true,
        'detail' => is_writable(BASE_DIR) ? BASE_DIR : 'Grant write permission (0755) to ' . BASE_DIR,
    ],
    [
        'label' => 'cURL & Fileinfo (Optional)',
        'ok' => extension_loaded('curl') && extension_loaded('fileinfo'),
        'required' => false,
        'detail' => (extension_loaded('curl') ? 'curl OK' : 'curl fallback') . ' / ' . (extension_loaded('fileinfo') ? 'fileinfo OK' : 'extension map fallback'),
    ],
];

$allReqPassed = true;
foreach ($requirements as $req) {
    if ($req['required'] && !$req['ok']) {
        $allReqPassed = false;
        break;
    }
}

$errors = [];
$installedSuccess = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$isLocked) {
    $postedCsrf = (string) ($_POST['csrf_token'] ?? '');
    if (!hash_equals($csrfToken, $postedCsrf)) {
        $errors[] = 'Invalid security token. Please refresh the page and try again.';
    } elseif (!$allReqPassed) {
        $errors[] = 'Please resolve the required server checks before installing.';
    } else {
        $dbDriver = ($_POST['db_driver'] ?? 'sqlite') === 'mysql' ? 'mysql' : 'sqlite';
        $dbHost = trim((string) ($_POST['db_host'] ?? '127.0.0.1'));
        $dbPort = max(1, (int) ($_POST['db_port'] ?? 3306));
        $dbName = trim((string) ($_POST['db_name'] ?? 'printflow'));
        $dbUser = trim((string) ($_POST['db_user'] ?? ''));
        $dbPass = (string) ($_POST['db_pass'] ?? '');

        $shopName = trim((string) ($_POST['shop_name'] ?? 'PrintFlow Digital Hub'));
        $shopAddress = trim((string) ($_POST['shop_address'] ?? 'Shop 14, Ground Floor, Tech Plaza'));
        $upiId = trim((string) ($_POST['upi_id'] ?? 'printflow@upi'));
        $bwRate = max(0.5, (float) ($_POST['bw_rate'] ?? 2));
        $colorRate = max(1.0, (float) ($_POST['color_rate'] ?? 10));
        $waNumber = trim((string) ($_POST['wa_number'] ?? '+919876543210'));
        $waVerifyToken = trim((string) ($_POST['wa_verify_token'] ?? ''));
        $adminPasscode = trim((string) ($_POST['admin_passcode'] ?? ''));

        if ($shopName === '') {
            $errors[] = 'Shop Name is required.';
        }
        if ($upiId === '' || strpos($upiId, '@') === false) {
            $errors[] = 'Enter a valid UPI ID (e.g. yourshop@upi).';
        }
        if (strlen($adminPasscode) < 4) {
            $errors[] = 'Admin Passcode must be at least 4 characters.';
        }
        if ($dbDriver === 'mysql' && ($dbHost === '' || $dbName === '' || $dbUser === '')) {
            $errors[] = 'MySQL Host, Database Name, and Username are required.';
        }

        if (empty($errors)) {
            try {
                foreach ([STORAGE_DIR, CONFIG_DIR, UPLOAD_DIR, API_DIR] as $dir) {
                    if (!is_dir($dir) && !mkdir($dir, 0755, true)) {
                        throw new RuntimeException('Unable to create directory: ' . $dir);
                    }
                }

                if ($dbDriver === 'mysql') {
                    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $dbHost, $dbPort, $dbName);
                    $pdo = new PDO($dsn, $dbUser, $dbPass, [
                        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                        PDO::ATTR_EMULATE_PREPARES => false,
                    ]);
                } else {
                    $sqlitePath = STORAGE_DIR . '/printflow.sqlite';
                    $pdo = new PDO('sqlite:' . $sqlitePath, null, null, [
                        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                        PDO::ATTR_EMULATE_PREPARES => false,
                    ]);
                }

                $longText = $dbDriver === 'mysql' ? 'LONGTEXT' : 'TEXT';
                $pdo->exec("CREATE TABLE IF NOT EXISTS printflow_state (
                    state_key VARCHAR(64) PRIMARY KEY,
                    state_json {$longText} NOT NULL,
                    updated_at VARCHAR(40) NOT NULL
                )");

                $idCol = $dbDriver === 'mysql' ? 'id VARCHAR(64) PRIMARY KEY' : 'id TEXT PRIMARY KEY';
                $pdo->exec("CREATE TABLE IF NOT EXISTS print_jobs (
                    {$idCol},
                    shop_id VARCHAR(64) NOT NULL,
                    code VARCHAR(24) NOT NULL,
                    pin VARCHAR(12) NOT NULL,
                    source VARCHAR(24) NOT NULL DEFAULT 'web_upload',
                    customer_name VARCHAR(100) NOT NULL DEFAULT 'Walk-in Customer',
                    customer_phone VARCHAR(30) NOT NULL DEFAULT '',
                    original_filename VARCHAR(255) NOT NULL,
                    stored_filename VARCHAR(255) NOT NULL,
                    mime_type VARCHAR(120) NOT NULL,
                    detected_pages INT NOT NULL DEFAULT 1,
                    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                    payment_status VARCHAR(24) NOT NULL DEFAULT 'pending',
                    print_status VARCHAR(32) NOT NULL DEFAULT 'awaiting_payment',
                    created_at VARCHAR(40) NOT NULL
                )");

                $defaultShop = [
                    'id' => 'shop-main',
                    'slug' => 'main',
                    'active' => true,
                    'createdAt' => gmdate('c'),
                    'agentKey' => bin2hex(random_bytes(24)),
                    'settings' => [
                        'shopName' => $shopName,
                        'shopTagline' => 'Scan QR, Pay via UPI, Collect Instant Prints',
                        'shopAddress' => $shopAddress ?: 'Main Print Counter',
                        'gstNumber' => '',
                        'pricing' => [
                            'bwPerPage' => $bwRate,
                            'colorPerPage' => $colorRate,
                            'duplexDiscountPercent' => 10,
                            'a3Multiplier' => 2,
                            'photo4x6Rate' => 25,
                            'minOrderAmount' => 5,
                        ],
                        'payment' => [
                            'upiId' => $upiId,
                            'upiPayeeName' => $shopName,
                            'autoPrintOnPayment' => true,
                            'sandboxInstantPayEnabled' => true,
                        ],
                        'printers' => [
                            'bwPrinterName' => 'HP LaserJet Pro M404dn (B&W)',
                            'colorPrinterName' => 'Epson EcoTank L8050 (Color)',
                            'photoPrinterName' => 'Canon PIXMA G670 (Photo)',
                            'bridgeMode' => 'browser_auto',
                            'ippEndpoint' => '',
                            'paperTrayRemaining' => 450,
                        ],
                        'whatsapp' => [
                            'enabled' => true,
                            'businessNumber' => $waNumber,
                            'welcomeMessage' => 'Namaste! Send any PDF, Document, or Photo here. Reply with options like "Color 2 copies" to get your instant QR payment link.',
                            'autoReplyOnUpload' => true,
                            'defaultColorMode' => 'bw',
                        ],
                        'formats' => [
                            'allowedExtensions' => ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.jpg', '.jpeg', '.png', '.webp', '.txt', '.csv'],
                            'maxFileSizeMb' => 25,
                            'autoDeleteHours' => 24,
                        ],
                        'loyalty' => [
                            'enabled' => true,
                            'earnMode' => 'per_rupee',
                            'earnRate' => 1,
                        ],
                    ],
                ];

                $initialStore = [
                    'shops' => [$defaultShop],
                    'jobs' => [],
                    'whatsappLogs' => [],
                    'loyaltyAccounts' => new stdClass(),
                    'adminPasscodeHash' => password_hash($adminPasscode, PASSWORD_BCRYPT),
                ];

                $stateJson = json_encode($initialStore, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                $stmt = $dbDriver === 'mysql'
                    ? $pdo->prepare('INSERT INTO printflow_state (state_key, state_json, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = VALUES(updated_at)')
                    : $pdo->prepare('INSERT OR REPLACE INTO printflow_state (state_key, state_json, updated_at) VALUES (?, ?, ?)');
                $stmt->execute(['main', $stateJson, gmdate('c')]);

                $configExport = [
                    'db_driver' => $dbDriver,
                    'db_host' => $dbHost,
                    'db_port' => $dbPort,
                    'db_name' => $dbName,
                    'db_user' => $dbUser,
                    'db_pass' => $dbPass,
                    'sqlite_path' => STORAGE_DIR . '/printflow.sqlite',
                    'app_secret' => bin2hex(random_bytes(32)),
                    'wa_verify_token' => $waVerifyToken ?: bin2hex(random_bytes(12)),
                    'installed_at' => gmdate('c'),
                ];
                $configFileContent = "<?php\nreturn " . var_export($configExport, true) . ";\n";
                file_put_contents(CONFIG_DIR . '/app.php', $configFileContent);
                @chmod(CONFIG_DIR . '/app.php', 0640);

                // Protect uploads, storage, and config directories
                $denyScriptHtaccess = "Options -Indexes\n<FilesMatch \"\\.(php|phtml|php\\d|phar|cgi|pl|py|sh)$\">\n  Require all denied\n</FilesMatch>\n";
                file_put_contents(UPLOAD_DIR . '/.htaccess', $denyScriptHtaccess);
                file_put_contents(STORAGE_DIR . '/.htaccess', "Require all denied\n");
                file_put_contents(CONFIG_DIR . '/.htaccess', "Require all denied\n");

                // Safe upload limits for cPanel PHP 8+ FPM/CGI (never triggers 500 like php_value in .htaccess)
                $userIni = "upload_max_filesize = 32M\npost_max_size = 32M\nmax_execution_time = 60\n";
                @file_put_contents(BASE_DIR . '/.user.ini', $userIni);
                @file_put_contents(API_DIR . '/.user.ini', $userIni);

                // Write root .htaccess for Apache SPA + /api/* routing + Authorization header forwarding
                $rootHtaccess = <<<'HTACCESS'
Options -Indexes

<IfModule mod_rewrite.c>
  RewriteEngine On

  # Preserve Authorization Bearer header on cPanel Apache CGI / PHP-FPM
  RewriteCond %{HTTP:Authorization} .
  RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]

  # Block direct access to internal folders and files
  RewriteRule ^(config|storage|data|dist-server|node_modules|windows-client|android-client)/ - [F,L]
  RewriteRule ^(\.env|store\.json|composer\.json|package\.json) - [F,L]

  # Route all /api/* requests to PHP backend router
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteRule ^api/(.*)$ api/index.php?_route=/api/$1 [QSA,L]

  # Serve existing static assets directly
  RewriteCond %{REQUEST_FILENAME} -f [OR]
  RewriteCond %{REQUEST_FILENAME} -d
  RewriteRule ^ - [L]

  # React SPA fallback
  RewriteRule ^ index.html [L]
</IfModule>
HTACCESS;
                file_put_contents(BASE_DIR . '/.htaccess', $rootHtaccess);

                // Write full-featured standalone PHP API router (api/index.php)
                $apiRouterCode = <<<'PHP'
<?php
declare(strict_types=1);

@ini_set('display_errors', '0');
@ini_set('log_errors', '1');
date_default_timezone_set('UTC');

if (version_compare(PHP_VERSION, '8.0.0', '<')) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'PHP 8.0 or higher is required. Current: ' . PHP_VERSION]);
    exit;
}

set_exception_handler(static function (Throwable $e): void {
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        header('X-Content-Type-Options: nosniff');
    }
    echo json_encode(['error' => 'Server error: ' . $e->getMessage()], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
});

define('BASE_DIR', realpath(__DIR__ . '/..') ?: dirname(__DIR__));
define('UPLOAD_DIR', realpath(BASE_DIR . '/uploads') ?: (BASE_DIR . '/uploads'));
if (!is_dir(UPLOAD_DIR)) {
    @mkdir(UPLOAD_DIR, 0755, true);
}

$configPath = BASE_DIR . '/config/app.php';
if (!file_exists($configPath)) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Application not installed. Open /install.php first.']);
    exit;
}
$config = require $configPath;

$dsn = ($config['db_driver'] ?? 'sqlite') === 'mysql'
    ? sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', (string) $config['db_host'], (int) $config['db_port'], (string) $config['db_name'])
    : 'sqlite:' . (string) $config['sqlite_path'];

$pdo = new PDO($dsn, !empty($config['db_user']) ? (string) $config['db_user'] : null, !empty($config['db_pass']) ? (string) $config['db_pass'] : null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
]);

function sendJson($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function getJsonBody(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function getBearerToken(): string {
    $auth = (string) (
        $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_REDIRECT_HTTP_AUTHORIZATION']
        ?? ''
    );
    if ($auth === '' && function_exists('getallheaders')) {
        $headers = getallheaders();
        if (is_array($headers)) {
            foreach ($headers as $k => $v) {
                if (strtolower((string) $k) === 'authorization') {
                    $auth = (string) $v;
                    break;
                }
            }
        }
    }
    if ($auth === '' && function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        if (is_array($headers)) {
            foreach ($headers as $k => $v) {
                if (strtolower((string) $k) === 'authorization') {
                    $auth = (string) $v;
                    break;
                }
            }
        }
    }
    if (stripos($auth, 'Bearer ') === 0) {
        return trim(substr($auth, 7));
    }
    return '';
}

function base64UrlEncode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function base64UrlDecode(string $data): string {
    $rem = strlen($data) % 4;
    if ($rem) $data .= str_repeat('=', 4 - $rem);
    return base64_decode(strtr($data, '-_', '+/')) ?: '';
}

function signToken(array $config): string {
    $payload = base64UrlEncode((string) json_encode([
        'role' => 'admin',
        'iat' => time(),
        'exp' => time() + (12 * 3600),
    ]));
    $sig = base64UrlEncode(hash_hmac('sha256', $payload, (string) $config['app_secret'], true));
    return $payload . '.' . $sig;
}

function verifyToken(string $token, array $config): bool {
    $parts = explode('.', $token);
    if (count($parts) !== 2) return false;
    [$payload, $sig] = $parts;
    $expected = base64UrlEncode(hash_hmac('sha256', $payload, (string) $config['app_secret'], true));
    if (!hash_equals($expected, $sig)) return false;
    $decoded = json_decode(base64UrlDecode($payload), true);
    return is_array($decoded) && ($decoded['role'] ?? '') === 'admin' && ((int) ($decoded['exp'] ?? 0)) > time();
}

function requireAdminAuth(array $config): void {
    $tok = getBearerToken();
    if (!$tok || !verifyToken($tok, $config)) {
        sendJson(['error' => 'Admin authentication required'], 401);
    }
}

function loadState(PDO $pdo): array {
    $stmt = $pdo->prepare('SELECT state_json FROM printflow_state WHERE state_key = ?');
    $stmt->execute(['main']);
    $row = $stmt->fetch();
    $data = $row ? json_decode((string) $row['state_json'], true) : [];
    if (!is_array($data)) $data = [];
    if (empty($data['shops']) || !is_array($data['shops'])) $data['shops'] = [];
    if (!isset($data['jobs']) || !is_array($data['jobs'])) $data['jobs'] = [];
    if (!isset($data['whatsappLogs']) || !is_array($data['whatsappLogs'])) $data['whatsappLogs'] = [];
    if (!isset($data['loyaltyAccounts']) || !is_array($data['loyaltyAccounts'])) $data['loyaltyAccounts'] = [];
    return $data;
}

function saveState(PDO $pdo, array $config, array $state): void {
    if (empty($state['loyaltyAccounts'])) {
        $state['loyaltyAccounts'] = new stdClass();
    }
    $json = json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $stmt = $config['db_driver'] === 'mysql'
        ? $pdo->prepare('INSERT INTO printflow_state (state_key, state_json, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = VALUES(updated_at)')
        : $pdo->prepare('INSERT OR REPLACE INTO printflow_state (state_key, state_json, updated_at) VALUES (?, ?, ?)');
    $stmt->execute(['main', $json, gmdate('c')]);
}

function getBaseUrl(): string {
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    $proto = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ($https ? 'https' : 'http');
    $host = $_SERVER['HTTP_X_FORWARDED_HOST'] ?? ($_SERVER['HTTP_HOST'] ?? 'localhost');
    $scriptDir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
    $rootPath = preg_replace('#/api$#', '', $scriptDir) ?: '';
    return $proto . '://' . $host . $rootPath;
}

function resolveShop(array $state, string $idOrSlug = ''): array {
    $q = strtolower(trim($idOrSlug));
    if ($q !== '') {
        foreach ($state['shops'] as $s) {
            if (strtolower((string) $s['id']) === $q || strtolower((string) $s['slug']) === $q) {
                return $s;
            }
        }
    }
    foreach ($state['shops'] as $s) {
        if (!empty($s['active'])) return $s;
    }
    return $state['shops'][0];
}

function normalizePhone(string $phone): string {
    $digits = preg_replace('/\D/', '', $phone) ?? '';
    if (strlen($digits) < 6) return '';
    return strlen($digits) > 10 ? substr($digits, -10) : $digits;
}

function maskPhone(string $phone): string {
    $c = trim($phone);
    if ($c === '') return '';
    if (strlen($c) <= 4) return '••••';
    return substr($c, 0, 3) . '••••' . substr($c, -4);
}

function sanitizeJob(array $job, array $state): array {
    $key = normalizePhone((string) ($job['customerPhone'] ?? ''));
    if ($key !== '' && isset($state['loyaltyAccounts'][$key])) {
        $job['loyaltyCustomerBalance'] = $state['loyaltyAccounts'][$key]['points'];
    }
    if (!empty($job['customerPhone'])) {
        $job['customerPhone'] = maskPhone((string) $job['customerPhone']);
    }
    return $job;
}

function computePricing(int $pages, array $options, array $settings): array {
    $p = $settings['pricing'];
    $unitRate = ($options['colorMode'] ?? 'bw') === 'color' ? (float) $p['colorPerPage'] : (float) $p['bwPerPage'];
    $multiplier = 1.0;
    if (($options['paperSize'] ?? 'A4') === 'Photo_4x6') {
        $unitRate = (float) $p['photo4x6Rate'];
    } elseif (($options['paperSize'] ?? 'A4') === 'A3') {
        $multiplier = (float) $p['a3Multiplier'];
    }
    $copies = max(1, (int) ($options['copies'] ?? 1));
    $subtotal = $pages * $copies * $unitRate * $multiplier;
    $discountRate = (($options['sides'] ?? 'single') === 'double' && $pages * $copies >= 2)
        ? ((float) $p['duplexDiscountPercent'] / 100.0)
        : 0.0;
    $duplexDiscount = round($subtotal * $discountRate, 2);
    $total = max((float) $p['minOrderAmount'], round($subtotal - $duplexDiscount, 2));
    return [
        'unitRate' => $unitRate,
        'multiplier' => $multiplier,
        'duplexDiscount' => $duplexDiscount,
        'subtotal' => round($subtotal, 2),
        'totalAmount' => $total,
        'currency' => 'INR',
    ];
}

function computeLoyaltyPoints(int $pages, int $copies, float $totalAmount, array $loyalty): int {
    if (empty($loyalty['enabled']) || ((float) ($loyalty['earnRate'] ?? 0)) <= 0) return 0;
    $rate = (float) $loyalty['earnRate'];
    $mode = $loyalty['earnMode'] ?? 'per_rupee';
    if ($mode === 'per_page') {
        $raw = $pages * max(1, $copies) * $rate;
    } elseif ($mode === 'per_job') {
        $raw = $rate;
    } else {
        $raw = $totalAmount * $rate;
    }
    return max(1, (int) floor($raw));
}

function buildUpiUri(string $code, float $amount, array $settings): string {
    return 'upi://pay?' . http_build_query([
        'pa' => $settings['payment']['upiId'],
        'pn' => $settings['payment']['upiPayeeName'],
        'am' => number_format($amount, 2, '.', ''),
        'cu' => 'INR',
        'tn' => 'Print ' . $code,
    ]);
}

function pickPrinter(array $options, array $settings): string {
    if (($options['paperSize'] ?? 'A4') === 'Photo_4x6') return (string) $settings['printers']['photoPrinterName'];
    return ($options['colorMode'] ?? 'bw') === 'color'
        ? (string) $settings['printers']['colorPrinterName']
        : (string) $settings['printers']['bwPrinterName'];
}

function parsePageRangeCount(string $pageRange, int $totalPages): int {
    $clean = strtolower(trim($pageRange));
    if ($clean === '' || $clean === 'all') return $totalPages;
    $selected = [];
    foreach (explode(',', $clean) as $part) {
        $part = trim($part);
        if (strpos($part, '-') !== false) {
            [$s, $e] = array_map('intval', explode('-', $part, 2));
            if ($s >= 1 && $e >= $s) {
                for ($i = $s; $i <= min($e, $totalPages); $i++) $selected[$i] = true;
            }
        } else {
            $n = (int) $part;
            if ($n >= 1 && $n <= $totalPages) $selected[$n] = true;
        }
    }
    return count($selected) > 0 ? count($selected) : $totalPages;
}

function detectPageCount(string $filePath, string $ext): int {
    if ($ext === '.pdf') {
        $content = @file_get_contents($filePath);
        if ($content !== false && preg_match_all('/\/Type\s*\/Page\b(?!s)/', $content, $matches)) {
            return max(1, count($matches[0]));
        }
        return 1;
    }
    if ($ext === '.txt' || $ext === '.csv') {
        $lines = @file($filePath);
        return $lines ? max(1, (int) ceil(count($lines) / 45)) : 1;
    }
    return 1;
}

function awardLoyaltyForJob(array &$job, array &$state): void {
    if (($job['paymentStatus'] ?? '') !== 'paid' || ($job['printStatus'] ?? '') !== 'completed' || !empty($job['loyaltyAwarded'])) {
        return;
    }
    $shop = resolveShop($state, (string) $job['shopId']);
    $pts = computeLoyaltyPoints(
        (int) $job['printablePages'],
        (int) $job['options']['copies'],
        (float) $job['pricingBreakdown']['totalAmount'],
        $shop['settings']['loyalty']
    );
    $job['loyaltyPointsEarned'] = $pts;
    $job['loyaltyAwarded'] = true;
    $key = normalizePhone((string) ($job['customerPhone'] ?? ''));
    if ($pts > 0 && $key !== '') {
        if (!isset($state['loyaltyAccounts'][$key])) {
            $state['loyaltyAccounts'][$key] = [
                'phone' => $key,
                'customerName' => (string) ($job['customerName'] ?: 'PrintFlow Member'),
                'points' => 0,
                'totalJobsCompleted' => 0,
                'totalEarned' => 0,
                'updatedAt' => gmdate('c'),
            ];
        }
        $state['loyaltyAccounts'][$key]['points'] += $pts;
        $state['loyaltyAccounts'][$key]['totalEarned'] += $pts;
        $state['loyaltyAccounts'][$key]['totalJobsCompleted'] += 1;
        $state['loyaltyAccounts'][$key]['updatedAt'] = gmdate('c');
        $job['loyaltyCustomerBalance'] = $state['loyaltyAccounts'][$key]['points'];
    }
}

function verifyAgentShop(array $state): ?array {
    $key = trim((string) ($_SERVER['HTTP_X_AGENT_KEY'] ?? ''));
    if ($key === '') return null;
    foreach ($state['shops'] as $s) {
        if (!empty($s['agentKey']) && hash_equals((string) $s['agentKey'], $key)) {
            return $s;
        }
    }
    return null;
}

function slugify(string $text): string {
    $s = strtolower(trim(preg_replace('/[^a-zA-Z0-9]+/', '-', $text) ?? ''));
    $s = trim($s, '-');
    return substr($s, 0, 32) ?: ('shop-' . random_int(100, 999));
}

// Resolve route
$route = (string) ($_GET['_route'] ?? '');
if ($route === '') {
    $uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $pos = strpos($uriPath, '/api/');
    $route = $pos !== false ? substr($uriPath, $pos) : ('/api/' . ltrim((string) ($_GET['action'] ?? 'health'), '/'));
}
$route = '/' . ltrim($route, '/');
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

$state = loadState($pdo);

// SSE Heartbeat (non-blocking for PHP shared hosting)
if ($route === '/api/events' && $method === 'GET') {
    header('Content-Type: text/event-stream');
    header('Cache-Control: no-cache');
    echo "retry: 5000\nevent: connected\ndata: {\"ok\":true,\"mode\":\"php\"}\n\n";
    exit;
}

if (($route === '/api/health' || $route === '/api/') && $method === 'GET') {
    sendJson(['status' => 'ok', 'time' => gmdate('c'), 'shops' => count($state['shops']), 'runtime' => 'php']);
}

if ($route === '/api/public/config' && $method === 'GET') {
    $shop = resolveShop($state, (string) ($_GET['shop'] ?? ''));
    $s = $shop['settings'];
    $publicShops = [];
    foreach ($state['shops'] as $sh) {
        if (empty($sh['active'])) continue;
        $publicShops[] = [
            'id' => $sh['id'],
            'slug' => $sh['slug'],
            'shopName' => $sh['settings']['shopName'],
            'shopAddress' => $sh['settings']['shopAddress'],
            'upiId' => $sh['settings']['payment']['upiId'],
            'whatsappNumber' => $sh['settings']['whatsapp']['businessNumber'],
            'whatsappEnabled' => (bool) $sh['settings']['whatsapp']['enabled'],
        ];
    }
    sendJson([
        'shopId' => $shop['id'],
        'shopSlug' => $shop['slug'],
        'shopName' => $s['shopName'],
        'shopTagline' => $s['shopTagline'],
        'shopAddress' => $s['shopAddress'],
        'pricing' => $s['pricing'],
        'payment' => $s['payment'],
        'printers' => [
            'bwPrinterName' => $s['printers']['bwPrinterName'],
            'colorPrinterName' => $s['printers']['colorPrinterName'],
            'photoPrinterName' => $s['printers']['photoPrinterName'],
            'bridgeMode' => $s['printers']['bridgeMode'],
            'paperTrayRemaining' => $s['printers']['paperTrayRemaining'],
        ],
        'whatsapp' => [
            'enabled' => (bool) $s['whatsapp']['enabled'],
            'businessNumber' => $s['whatsapp']['businessNumber'],
            'defaultColorMode' => $s['whatsapp']['defaultColorMode'],
        ],
        'formats' => $s['formats'],
        'loyalty' => $s['loyalty'],
        'shops' => $publicShops,
    ]);
}

if ($route === '/api/public/queue' && $method === 'GET') {
    $shopParam = trim((string) ($_GET['shop'] ?? ''));
    $targetShop = $shopParam !== '' ? resolveShop($state, $shopParam) : null;
    $filtered = [];
    foreach ($state['jobs'] as $j) {
        if ($targetShop && $j['shopId'] !== $targetShop['id']) continue;
        $filtered[] = sanitizeJob($j, $state);
        if (count($filtered) >= 12) break;
    }
    sendJson(['jobs' => $filtered]);
}

if ($route === '/api/loyalty/balance' && $method === 'GET') {
    $key = normalizePhone((string) ($_GET['phone'] ?? ''));
    if ($key === '') sendJson(['error' => 'Enter a valid 6+ digit mobile number.'], 400);
    $acct = $state['loyaltyAccounts'][$key] ?? null;
    if (!$acct) {
        sendJson(['found' => false, 'phone' => $key, 'customerName' => '', 'points' => 0, 'totalJobsCompleted' => 0, 'totalEarned' => 0]);
    }
    sendJson([
        'found' => true,
        'phone' => $acct['phone'],
        'customerName' => $acct['customerName'],
        'points' => (int) $acct['points'],
        'totalJobsCompleted' => (int) $acct['totalJobsCompleted'],
        'totalEarned' => (int) $acct['totalEarned'],
    ]);
}

if ($route === '/api/qr-image' && $method === 'GET') {
    // Frontend uses local qrcode canvas rendering; return simple placeholder SVG if requested directly
    $text = htmlspecialchars((string) ($_GET['text'] ?? ''), ENT_QUOTES, 'UTF-8');
    $svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><rect width="240" height="240" fill="#fff"/><text x="120" y="120" font-size="11" text-anchor="middle" fill="#0f172a">' . substr($text, 0, 28) . '</text></svg>';
    sendJson(['dataUrl' => 'data:image/svg+xml;base64,' . base64_encode($svg)]);
}

if ($route === '/api/jobs' && $method === 'POST') {
    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        sendJson(['error' => 'Please select a document or image file to upload.'], 400);
    }
    $shop = resolveShop($state, (string) ($_POST['shopId'] ?? ''));
    $settings = $shop['settings'];
    $origName = basename((string) $_FILES['file']['name']);
    $ext = '.' . strtolower((string) pathinfo($origName, PATHINFO_EXTENSION));
    if ($ext === '.') $ext = '.bin';
    $allowed = array_map('strtolower', $settings['formats']['allowedExtensions']);
    if (!in_array($ext, $allowed, true)) {
        sendJson(['error' => "Unsupported file format ({$ext})."], 400);
    }
    $maxBytes = ((int) $settings['formats']['maxFileSizeMb']) * 1024 * 1024;
    if ((int) $_FILES['file']['size'] > $maxBytes) {
        sendJson(['error' => 'File exceeds maximum allowed size.'], 400);
    }

    $id = bin2hex(random_bytes(16));
    $stored = bin2hex(random_bytes(16)) . $ext;
    $dest = UPLOAD_DIR . '/' . $stored;
    if (!move_uploaded_file($_FILES['file']['tmp_name'], $dest)) {
        sendJson(['error' => 'Failed to save uploaded file.'], 500);
    }

    $detectedPages = detectPageCount($dest, $ext);
    $options = [
        'colorMode' => ($_POST['colorMode'] ?? 'bw') === 'color' ? 'color' : 'bw',
        'paperSize' => in_array($_POST['paperSize'] ?? 'A4', ['A4', 'A3', 'Letter', 'Legal', 'Photo_4x6'], true) ? $_POST['paperSize'] : 'A4',
        'sides' => ($_POST['sides'] ?? 'single') === 'double' ? 'double' : 'single',
        'copies' => max(1, min(200, (int) ($_POST['copies'] ?? 1))),
        'pageRange' => substr((string) ($_POST['pageRange'] ?? 'all'), 0, 64),
        'orientation' => in_array($_POST['orientation'] ?? 'auto', ['auto', 'portrait', 'landscape'], true) ? $_POST['orientation'] : 'auto',
    ];
    $printablePages = parsePageRangeCount($options['pageRange'], $detectedPages);
    $pricing = computePricing($printablePages, $options, $settings);
    $code = 'PF-' . random_int(1000, 9999);
    $pin = (string) random_int(100000, 999999);
    $src = in_array($_POST['source'] ?? 'web_upload', ['web_upload', 'kiosk_qr', 'whatsapp'], true) ? $_POST['source'] : 'web_upload';

    $job = [
        'id' => $id,
        'shopId' => $shop['id'],
        'shopName' => $settings['shopName'],
        'code' => $code,
        'pin' => $pin,
        'source' => $src,
        'customerName' => substr(trim((string) ($_POST['customerName'] ?? 'Walk-in Customer')) ?: 'Walk-in Customer', 0, 60),
        'customerPhone' => substr(trim((string) ($_POST['customerPhone'] ?? '')), 0, 20),
        'originalFilename' => $origName,
        'storedFilename' => $stored,
        'mimeType' => (string) ($_FILES['file']['type'] ?: 'application/octet-stream'),
        'fileExtension' => $ext,
        'fileSizeBytes' => (int) $_FILES['file']['size'],
        'detectedPages' => $detectedPages,
        'printablePages' => $printablePages,
        'options' => $options,
        'pricingBreakdown' => $pricing,
        'paymentStatus' => 'pending',
        'upiUri' => buildUpiUri($code, (float) $pricing['totalAmount'], $settings),
        'printStatus' => 'awaiting_payment',
        'assignedPrinter' => pickPrinter($options, $settings),
        'createdAt' => gmdate('c'),
        'notes' => '',
        'loyaltyPointsEarned' => computeLoyaltyPoints($printablePages, $options['copies'], (float) $pricing['totalAmount'], $settings['loyalty']),
        'loyaltyAwarded' => false,
    ];

    array_unshift($state['jobs'], $job);
    saveState($pdo, $config, $state);
    sendJson(['job' => sanitizeJob($job, $state), 'qrDataUrl' => ''], 201);
}

if (preg_match('#^/api/jobs/([^/]+)/options$#', $route, $m) && $method === 'PATCH') {
    $id = $m[1];
    $body = getJsonBody();
    foreach ($state['jobs'] as &$job) {
        if ($job['id'] === $id) {
            if ($job['paymentStatus'] === 'paid') sendJson(['error' => 'Options cannot be changed after payment.'], 400);
            $shop = resolveShop($state, (string) $job['shopId']);
            $job['options'] = [
                'colorMode' => ($body['colorMode'] ?? $job['options']['colorMode']) === 'color' ? 'color' : 'bw',
                'paperSize' => in_array($body['paperSize'] ?? '', ['A4', 'A3', 'Letter', 'Legal', 'Photo_4x6'], true) ? $body['paperSize'] : $job['options']['paperSize'],
                'sides' => ($body['sides'] ?? $job['options']['sides']) === 'double' ? 'double' : 'single',
                'copies' => max(1, min(200, (int) ($body['copies'] ?? $job['options']['copies']))),
                'pageRange' => substr((string) ($body['pageRange'] ?? $job['options']['pageRange']), 0, 64),
                'orientation' => in_array($body['orientation'] ?? '', ['auto', 'portrait', 'landscape'], true) ? $body['orientation'] : $job['options']['orientation'],
            ];
            $job['printablePages'] = parsePageRangeCount($job['options']['pageRange'], (int) $job['detectedPages']);
            $job['pricingBreakdown'] = computePricing((int) $job['printablePages'], $job['options'], $shop['settings']);
            $job['upiUri'] = buildUpiUri((string) $job['code'], (float) $job['pricingBreakdown']['totalAmount'], $shop['settings']);
            $job['assignedPrinter'] = pickPrinter($job['options'], $shop['settings']);
            $job['loyaltyPointsEarned'] = computeLoyaltyPoints((int) $job['printablePages'], (int) $job['options']['copies'], (float) $job['pricingBreakdown']['totalAmount'], $shop['settings']['loyalty']);
            saveState($pdo, $config, $state);
            sendJson(['job' => sanitizeJob($job, $state), 'qrDataUrl' => '']);
        }
    }
    sendJson(['error' => 'Print job not found.'], 404);
}

if (preg_match('#^/api/jobs/([^/]+)/file$#', $route, $m) && $method === 'GET') {
    $id = $m[1];
    foreach ($state['jobs'] as $job) {
        if ($job['id'] === $id) {
            $path = UPLOAD_DIR . '/' . basename((string) $job['storedFilename']);
            if (!file_exists($path)) sendJson(['error' => 'Stored file no longer exists.'], 404);
            while (ob_get_level() > 0) {
                ob_end_clean();
            }
            header('X-Content-Type-Options: nosniff');
            header('Content-Type: ' . (($job['mimeType'] ?? '') ?: 'application/octet-stream'));
            $fsize = @filesize($path);
            if ($fsize !== false) header('Content-Length: ' . (string) $fsize);
            $disp = (($_GET['download'] ?? '') === '1') ? 'attachment' : 'inline';
            $safe = str_replace(['"', "\r", "\n"], '_', (string) $job['originalFilename']);
            header("Content-Disposition: {$disp}; filename=\"{$safe}\"");
            readfile($path);
            exit;
        }
    }
    sendJson(['error' => 'File not found.'], 404);
}

if (preg_match('#^/api/jobs/([^/]+)/pay$#', $route, $m) && $method === 'POST') {
    $id = $m[1];
    $body = getJsonBody();
    foreach ($state['jobs'] as &$job) {
        if ($job['id'] === $id) {
            if ($job['paymentStatus'] === 'paid') {
                sendJson(['job' => sanitizeJob($job, $state), 'alreadyPaid' => true]);
            }
            $shop = resolveShop($state, (string) $job['shopId']);
            $mode = (string) ($body['mode'] ?? 'upi_qr');
            $utr = substr(trim((string) ($body['utrNumber'] ?? '')), 0, 40);
            if ($mode === 'upi_sandbox' && empty($shop['settings']['payment']['sandboxInstantPayEnabled'])) {
                sendJson(['error' => 'Sandbox instant confirmation is disabled.'], 403);
            }
            if ($mode === 'upi_qr' && strlen($utr) < 6) {
                sendJson(['error' => 'Enter a valid 6+ digit UPI UTR / Reference number.'], 400);
            }
            $job['paymentStatus'] = 'paid';
            $job['paymentMethod'] = $mode === 'upi_sandbox' ? 'upi_sandbox' : 'upi_qr';
            $job['utrNumber'] = $utr !== '' ? $utr : ('UPI' . substr((string) time(), -8));
            $job['paidAt'] = gmdate('c');
            if (!empty($shop['settings']['payment']['autoPrintOnPayment']) && ($shop['settings']['printers']['bridgeMode'] ?? 'browser_auto') !== 'local_agent') {
                $job['printStatus'] = 'completed';
                $job['printedAt'] = gmdate('c');
                awardLoyaltyForJob($job, $state);
            } else {
                $job['printStatus'] = 'queued';
            }
            saveState($pdo, $config, $state);
            sendJson(['job' => sanitizeJob($job, $state)]);
        }
    }
    sendJson(['error' => 'Print job not found.'], 404);
}

if (preg_match('#^/api/jobs/([^/]+)/claim-loyalty$#', $route, $m) && $method === 'POST') {
    $id = $m[1];
    $body = getJsonBody();
    $rawPhone = substr(trim((string) ($body['phone'] ?? '')), 0, 20);
    $key = normalizePhone($rawPhone);
    if ($key === '') sendJson(['error' => 'Enter a valid 6+ digit mobile number.'], 400);
    foreach ($state['jobs'] as &$job) {
        if ($job['id'] === $id) {
            if ($job['paymentStatus'] !== 'paid' || $job['printStatus'] !== 'completed') {
                sendJson(['error' => 'Points can only be claimed after the job is printed.'], 400);
            }
            if (normalizePhone((string) ($job['customerPhone'] ?? '')) !== '') {
                sendJson(['error' => 'Loyalty points already linked to a mobile number.'], 409);
            }
            $job['customerPhone'] = $rawPhone;
            $job['loyaltyAwarded'] = false;
            awardLoyaltyForJob($job, $state);
            saveState($pdo, $config, $state);
            sendJson(['job' => sanitizeJob($job, $state), 'balance' => (int) ($job['loyaltyCustomerBalance'] ?? 0)]);
        }
    }
    sendJson(['error' => 'Print job not found.'], 404);
}

if (preg_match('#^/api/jobs/([^/]+)$#', $route, $m) && $method === 'GET') {
    $q = strtoupper(trim($m[1]));
    foreach ($state['jobs'] as $job) {
        if (strtoupper((string) $job['id']) === $q || strtoupper((string) $job['code']) === $q || $job['pin'] === $q) {
            sendJson(['job' => sanitizeJob($job, $state), 'qrDataUrl' => '']);
        }
    }
    sendJson(['error' => 'Job not found.'], 404);
}

if ($route === '/api/whatsapp/logs' && $method === 'GET') {
    $shopFilter = trim((string) ($_GET['shop'] ?? ''));
    $logs = [];
    foreach ($state['whatsappLogs'] as $l) {
        if ($shopFilter !== '' && ($l['shopId'] ?? '') !== $shopFilter) continue;
        $l['phone'] = maskPhone((string) ($l['phone'] ?? ''));
        $logs[] = $l;
        if (count($logs) >= 30) break;
    }
    sendJson(['logs' => $logs]);
}

if ($route === '/api/whatsapp/simulate' && $method === 'POST') {
    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        sendJson(['error' => 'Attach a document or image to simulate WhatsApp print.'], 400);
    }
    $shop = resolveShop($state, (string) ($_POST['shopId'] ?? ''));
    if (empty($shop['settings']['whatsapp']['enabled'])) {
        sendJson(['error' => 'WhatsApp print service is paused for this shop.'], 400);
    }
    $origName = basename((string) $_FILES['file']['name']);
    $ext = '.' . strtolower((string) pathinfo($origName, PATHINFO_EXTENSION));
    $stored = bin2hex(random_bytes(16)) . $ext;
    move_uploaded_file($_FILES['file']['tmp_name'], UPLOAD_DIR . '/' . $stored);

    $caption = substr(trim((string) ($_POST['caption'] ?? 'Color 1 copy')), 0, 200);
    $lower = strtolower($caption);
    $colorMode = (strpos($lower, 'color') !== false || strpos($lower, 'colour') !== false) ? 'color' : (string) $shop['settings']['whatsapp']['defaultColorMode'];
    $copies = 1;
    if (preg_match('/(\d+)\s*(?:copy|copies|x)/i', $lower, $cm)) {
        $copies = max(1, min(100, (int) $cm[1]));
    }
    $options = [
        'colorMode' => $colorMode === 'color' ? 'color' : 'bw',
        'paperSize' => strpos($lower, 'a3') !== false ? 'A3' : 'A4',
        'sides' => (strpos($lower, 'double') !== false || strpos($lower, 'duplex') !== false) ? 'double' : 'single',
        'copies' => $copies,
        'pageRange' => 'all',
        'orientation' => 'auto',
    ];
    $pages = detectPageCount(UPLOAD_DIR . '/' . $stored, $ext);
    $pricing = computePricing($pages, $options, $shop['settings']);
    $id = bin2hex(random_bytes(16));
    $code = 'PF-' . random_int(1000, 9999);
    $pin = (string) random_int(100000, 999999);
    $senderPhone = substr(trim((string) ($_POST['phone'] ?? '+919811223344')), 0, 20);
    $senderName = substr(trim((string) ($_POST['name'] ?? 'WhatsApp Customer')), 0, 60);

    $job = [
        'id' => $id,
        'shopId' => $shop['id'],
        'shopName' => $shop['settings']['shopName'],
        'code' => $code,
        'pin' => $pin,
        'source' => 'whatsapp',
        'customerName' => $senderName,
        'customerPhone' => $senderPhone,
        'originalFilename' => $origName,
        'storedFilename' => $stored,
        'mimeType' => (string) ($_FILES['file']['type'] ?: 'application/octet-stream'),
        'fileExtension' => $ext,
        'fileSizeBytes' => (int) $_FILES['file']['size'],
        'detectedPages' => $pages,
        'printablePages' => $pages,
        'options' => $options,
        'pricingBreakdown' => $pricing,
        'paymentStatus' => 'pending',
        'upiUri' => buildUpiUri($code, (float) $pricing['totalAmount'], $shop['settings']),
        'printStatus' => 'awaiting_payment',
        'assignedPrinter' => pickPrinter($options, $shop['settings']),
        'createdAt' => gmdate('c'),
        'notes' => 'WhatsApp caption: ' . $caption,
        'loyaltyPointsEarned' => computeLoyaltyPoints($pages, $copies, (float) $pricing['totalAmount'], $shop['settings']['loyalty']),
        'loyaltyAwarded' => false,
    ];
    $payLink = getBaseUrl() . '/?shop=' . urlencode((string) $shop['slug']) . '&job=' . $code;
    $replyText = "[{$shop['settings']['shopName']}] Job {$code} (PIN: {$pin}) · {$pages}p · Total ₹{$pricing['totalAmount']}. Pay here: {$payLink}";

    array_unshift($state['jobs'], $job);
    array_unshift($state['whatsappLogs'],
        ['id' => bin2hex(random_bytes(8)), 'shopId' => $shop['id'], 'shopName' => $shop['settings']['shopName'], 'direction' => 'outbound', 'phone' => $senderPhone, 'senderName' => $shop['settings']['shopName'], 'text' => $replyText, 'jobId' => $id, 'jobCode' => $code, 'timestamp' => gmdate('c')],
        ['id' => bin2hex(random_bytes(8)), 'shopId' => $shop['id'], 'shopName' => $shop['settings']['shopName'], 'direction' => 'inbound', 'phone' => $senderPhone, 'senderName' => $senderName, 'text' => $caption, 'attachmentName' => $origName, 'jobId' => $id, 'jobCode' => $code, 'timestamp' => gmdate('c')]
    );
    saveState($pdo, $config, $state);
    sendJson(['job' => sanitizeJob($job, $state), 'qrDataUrl' => '', 'replyText' => $replyText], 201);
}

if ($route === '/api/webhook/whatsapp' && $method === 'GET') {
    $mode = (string) ($_GET['hub_mode'] ?? $_GET['hub.mode'] ?? '');
    $token = (string) ($_GET['hub_verify_token'] ?? $_GET['hub.verify_token'] ?? '');
    $challenge = (string) ($_GET['hub_challenge'] ?? $_GET['hub.challenge'] ?? '');
    $expected = (string) ($config['wa_verify_token'] ?? '');
    if ($mode === 'subscribe' && $expected !== '' && hash_equals($expected, $token)) {
        header('Content-Type: text/plain');
        echo $challenge;
        exit;
    }
    sendJson(['error' => 'Forbidden'], 403);
}

if ($route === '/api/webhook/whatsapp' && $method === 'POST') {
    $body = getJsonBody();
    $entries = is_array($body['entry'] ?? null) ? $body['entry'] : [];
    foreach ($entries as $entry) {
        $changes = is_array($entry['changes'] ?? null) ? $entry['changes'] : [];
        foreach ($changes as $ch) {
            $val = is_array($ch['value'] ?? null) ? $ch['value'] : [];
            $messages = is_array($val['messages'] ?? null) ? $val['messages'] : [];
            $contacts = is_array($val['contacts'] ?? null) ? $val['contacts'] : [];
            $shop = resolveShop($state, '');
            foreach ($messages as $msg) {
                $from = substr((string) ($msg['from'] ?? '+919999999999'), 0, 20);
                $senderName = substr((string) ($contacts[0]['profile']['name'] ?? 'WhatsApp User'), 0, 60);
                $text = (string) ($msg['text']['body'] ?? $msg['document']['caption'] ?? $msg['image']['caption'] ?? '[Media]');
                $attach = (string) ($msg['document']['filename'] ?? (($msg['type'] ?? '') === 'image' ? 'whatsapp-image.jpg' : ''));
                array_unshift($state['whatsappLogs'], [
                    'id' => bin2hex(random_bytes(8)),
                    'shopId' => $shop['id'],
                    'shopName' => $shop['settings']['shopName'],
                    'direction' => 'inbound',
                    'phone' => $from,
                    'senderName' => $senderName,
                    'text' => $text,
                    'attachmentName' => $attach ?: null,
                    'timestamp' => gmdate('c'),
                ]);
            }
        }
    }
    saveState($pdo, $config, $state);
    sendJson(['ok' => true]);
}

// Auth Routes
if ($route === '/api/auth/status' && $method === 'GET') {
    $tok = getBearerToken();
    sendJson([
        'configured' => !empty($state['adminPasscodeHash']),
        'envControlled' => false,
        'authenticated' => $tok !== '' && verifyToken($tok, $config),
    ]);
}

if ($route === '/api/auth/setup' && $method === 'POST') {
    if (!empty($state['adminPasscodeHash'])) {
        sendJson(['error' => 'Admin passcode already configured. Please sign in.'], 409);
    }
    $body = getJsonBody();
    $pass = trim((string) ($body['passcode'] ?? ''));
    if (strlen($pass) < 4) sendJson(['error' => 'Passcode must be at least 4 characters.'], 400);
    $state['adminPasscodeHash'] = password_hash($pass, PASSWORD_BCRYPT);
    saveState($pdo, $config, $state);
    sendJson(['token' => signToken($config)], 201);
}

if ($route === '/api/auth/login' && $method === 'POST') {
    $body = getJsonBody();
    $pass = trim((string) ($body['passcode'] ?? ''));
    $hash = (string) ($state['adminPasscodeHash'] ?? '');
    if ($pass === '' || $hash === '' || !password_verify($pass, $hash)) {
        sendJson(['error' => 'Incorrect admin passcode.'], 401);
    }
    sendJson(['token' => signToken($config)]);
}

if ($route === '/api/auth/change-passcode' && $method === 'POST') {
    requireAdminAuth($config);
    $body = getJsonBody();
    $newPass = trim((string) ($body['newPasscode'] ?? ''));
    if (strlen($newPass) < 4) sendJson(['error' => 'New passcode must be 4+ characters.'], 400);
    $state['adminPasscodeHash'] = password_hash($newPass, PASSWORD_BCRYPT);
    saveState($pdo, $config, $state);
    sendJson(['ok' => true]);
}

// Print Agent Routes
if ($route === '/api/agent/pending' && $method === 'GET') {
    $shop = verifyAgentShop($state);
    if (!$shop) sendJson(['error' => 'Invalid or missing X-Agent-Key'], 401);
    $pending = array_values(array_filter($state['jobs'], fn($j) => $j['shopId'] === $shop['id'] && $j['paymentStatus'] === 'paid' && $j['printStatus'] === 'queued'));
    sendJson(['shopId' => $shop['id'], 'shopName' => $shop['settings']['shopName'], 'jobs' => $pending]);
}

if (preg_match('#^/api/agent/jobs/([^/]+)/file$#', $route, $m) && $method === 'GET') {
    $shop = verifyAgentShop($state);
    if (!$shop) sendJson(['error' => 'Invalid X-Agent-Key'], 401);
    foreach ($state['jobs'] as $job) {
        if ($job['id'] === $m[1] && $job['shopId'] === $shop['id']) {
            $path = UPLOAD_DIR . '/' . basename((string) $job['storedFilename']);
            if (!file_exists($path)) sendJson(['error' => 'File not found'], 404);
            while (ob_get_level() > 0) {
                ob_end_clean();
            }
            header('Content-Type: ' . (($job['mimeType'] ?? '') ?: 'application/octet-stream'));
            $fsize = @filesize($path);
            if ($fsize !== false) header('Content-Length: ' . (string) $fsize);
            readfile($path);
            exit;
        }
    }
    sendJson(['error' => 'Job not found'], 404);
}

if (preg_match('#^/api/agent/jobs/([^/]+)/status$#', $route, $m) && $method === 'POST') {
    $shop = verifyAgentShop($state);
    if (!$shop) sendJson(['error' => 'Invalid X-Agent-Key'], 401);
    $body = getJsonBody();
    $status = ($body['status'] ?? '') === 'error' ? 'error' : 'completed';
    foreach ($state['jobs'] as &$job) {
        if ($job['id'] === $m[1] && $job['shopId'] === $shop['id']) {
            $job['printStatus'] = $status;
            if ($status === 'completed') {
                $job['printedAt'] = gmdate('c');
                awardLoyaltyForJob($job, $state);
            }
            saveState($pdo, $config, $state);
            sendJson(['ok' => true, 'job' => sanitizeJob($job, $state)]);
        }
    }
    sendJson(['error' => 'Job not found'], 404);
}

// Admin Routes
if ($route === '/api/admin/jobs' && $method === 'GET') {
    requireAdminAuth($config);
    $shopFilter = trim((string) ($_GET['shopId'] ?? 'all'));
    $scoped = ($shopFilter !== '' && $shopFilter !== 'all')
        ? array_values(array_filter($state['jobs'], fn($j) => $j['shopId'] === $shopFilter))
        : $state['jobs'];
    $paid = array_filter($scoped, fn($j) => $j['paymentStatus'] === 'paid');
    $rev = array_reduce($paid, fn($a, $j) => $a + (float) $j['pricingBreakdown']['totalAmount'], 0.0);
    $pages = array_reduce(array_filter($scoped, fn($j) => $j['printStatus'] === 'completed'), fn($a, $j) => $a + ((int) $j['printablePages'] * (int) $j['options']['copies']), 0);
    $activeShop = ($shopFilter !== '' && $shopFilter !== 'all') ? resolveShop($state, $shopFilter) : $state['shops'][0];
    sendJson([
        'jobs' => $scoped,
        'shops' => $state['shops'],
        'stats' => [
            'totalJobs' => count($scoped),
            'paidJobs' => count($paid),
            'completedJobs' => count(array_filter($scoped, fn($j) => $j['printStatus'] === 'completed')),
            'pendingJobs' => count(array_filter($scoped, fn($j) => $j['printStatus'] === 'awaiting_payment')),
            'whatsappJobs' => count(array_filter($scoped, fn($j) => $j['source'] === 'whatsapp')),
            'totalRevenue' => round($rev, 2),
            'totalPagesPrinted' => $pages,
        ],
        'settings' => $activeShop['settings'],
    ]);
}

if ($route === '/api/admin/analytics' && $method === 'GET') {
    requireAdminAuth($config);
    $rawDays = (int) ($_GET['days'] ?? 14);
    $days = ($rawDays === 7 || $rawDays === 30) ? $rawDays : 14;
    $shopFilter = trim((string) ($_GET['shopId'] ?? 'all')) ?: 'all';
    $palette = ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];

    $dayBuckets = [];
    $dayIndexMap = [];
    $trendBuckets = [];
    $todayTs = strtotime('today midnight') ?: time();

    for ($i = $days - 1; $i >= 0; $i--) {
        $ts = strtotime("-{$i} days", $todayTs) ?: $todayTs;
        $dk = date('Y-m-d', $ts);
        $lbl = date('M j', $ts);
        $dayIndexMap[$dk] = count($dayBuckets);
        $dayBuckets[] = ['dateKey' => $dk, 'label' => $lbl, 'bwPages' => 0, 'colorPages' => 0, 'totalPages' => 0, 'jobsCount' => 0, 'revenue' => 0.0];
        $tr = ['dateKey' => $dk, 'label' => $lbl];
        foreach ($state['shops'] as $sh) $tr[$sh['id']] = 0.0;
        $trendBuckets[] = $tr;
    }

    $peakHours = [];
    for ($h = 0; $h < 24; $h++) {
        $h12 = $h % 12 === 0 ? 12 : $h % 12;
        $peakHours[] = ['hour' => $h, 'hourLabel' => sprintf('%02d:00', $h), 'shortHour' => $h12 . ($h < 12 ? 'a' : 'p'), 'jobsCount' => 0, 'pagesCount' => 0, 'revenue' => 0.0, 'bwJobs' => 0, 'colorJobs' => 0];
    }

    $shopAcc = [];
    foreach ($state['shops'] as $sh) {
        $shopAcc[$sh['id']] = ['totalRevenue' => 0.0, 'totalJobs' => 0, 'totalPages' => 0, 'whatsappJobs' => 0];
    }

    $sumRev = 0.0; $sumJobs = 0; $sumPaid = 0; $sumBw = 0; $sumColor = 0;
    foreach ($state['jobs'] as $job) {
        $cts = strtotime((string) ($job['createdAt'] ?? ''));
        if ($cts === false) continue;
        $ck = date('Y-m-d', $cts);
        $cIdx = $dayIndexMap[$ck] ?? null;
        $pages = ($job['printStatus'] ?? '') === 'cancelled' ? 0 : max(0, (int) ($job['printablePages'] ?? 1) * max(1, (int) ($job['options']['copies'] ?? 1)));
        $paidAtRaw = (string) ($job['paidAt'] ?? $job['createdAt'] ?? '');
        $pts = ($paidAtRaw !== '' ? strtotime($paidAtRaw) : false) ?: $cts;
        $pk = date('Y-m-d', $pts);
        $pIdx = $dayIndexMap[$pk] ?? null;
        $isPaid = ($job['paymentStatus'] ?? '') === 'paid';
        $amt = $isPaid ? (float) ($job['pricingBreakdown']['totalAmount'] ?? 0) : 0.0;

        if ($cIdx !== null && isset($shopAcc[$job['shopId']])) {
            $shopAcc[$job['shopId']]['totalJobs'] += 1;
            $shopAcc[$job['shopId']]['totalPages'] += $pages;
            if ($job['source'] === 'whatsapp') $shopAcc[$job['shopId']]['whatsappJobs'] += 1;
        }
        if ($isPaid && $pIdx !== null && isset($shopAcc[$job['shopId']])) {
            $shopAcc[$job['shopId']]['totalRevenue'] += $amt;
            $trendBuckets[$pIdx][$job['shopId']] = round(((float) ($trendBuckets[$pIdx][$job['shopId']] ?? 0)) + $amt, 2);
        }

        if ($shopFilter !== 'all' && $job['shopId'] !== $shopFilter) continue;

        if ($cIdx !== null) {
            $dayBuckets[$cIdx]['jobsCount'] += 1;
            $dayBuckets[$cIdx]['totalPages'] += $pages;
            $sumJobs += 1;
            if ($job['options']['colorMode'] === 'color') {
                $dayBuckets[$cIdx]['colorPages'] += $pages;
                $sumColor += $pages;
            } else {
                $dayBuckets[$cIdx]['bwPages'] += $pages;
                $sumBw += $pages;
            }
            $hr = (int) date('G', $cts);
            $peakHours[$hr]['jobsCount'] += 1;
            $peakHours[$hr]['pagesCount'] += $pages;
            if ($job['options']['colorMode'] === 'color') $peakHours[$hr]['colorJobs'] += 1;
            else $peakHours[$hr]['bwJobs'] += 1;
            if ($isPaid) $peakHours[$hr]['revenue'] = round($peakHours[$hr]['revenue'] + $amt, 2);
        }
        if ($isPaid && $pIdx !== null) {
            $dayBuckets[$pIdx]['revenue'] = round($dayBuckets[$pIdx]['revenue'] + $amt, 2);
            $sumRev += $amt;
            $sumPaid += 1;
        }
    }

    $allRev = array_reduce($shopAcc, fn($s, $x) => $s + $x['totalRevenue'], 0.0);
    $shopsMeta = [];
    foreach ($state['shops'] as $idx => $sh) {
        $acc = $shopAcc[$sh['id']] ?? ['totalRevenue' => 0.0, 'totalJobs' => 0, 'totalPages' => 0, 'whatsappJobs' => 0];
        $r = round($acc['totalRevenue'], 2);
        $shopsMeta[] = [
            'id' => $sh['id'],
            'name' => $sh['settings']['shopName'],
            'slug' => $sh['slug'],
            'totalRevenue' => $r,
            'totalJobs' => $acc['totalJobs'],
            'totalPages' => $acc['totalPages'],
            'whatsappJobs' => $acc['whatsappJobs'],
            'sharePercent' => $allRev > 0 ? round(($r / $allRev) * 100, 1) : 0,
            'color' => $palette[$idx % count($palette)],
        ];
    }

    $sortedMeta = $shopsMeta;
    usort($sortedMeta, fn($a, $b) => $b['totalRevenue'] <=> $a['totalRevenue']);
    $topShop = $sortedMeta[0] ?? null;
    $busiest = $peakHours[0];
    foreach ($peakHours as $ph) {
        if ($ph['jobsCount'] > $busiest['jobsCount']) $busiest = $ph;
    }

    sendJson([
        'days' => $days,
        'shopFilter' => $shopFilter,
        'summary' => [
            'totalRevenue' => round($sumRev, 2),
            'totalJobs' => $sumJobs,
            'paidJobs' => $sumPaid,
            'totalPages' => $sumBw + $sumColor,
            'bwPages' => $sumBw,
            'colorPages' => $sumColor,
            'avgOrderValue' => $sumPaid > 0 ? round($sumRev / $sumPaid, 2) : 0,
            'peakHourLabel' => $busiest['jobsCount'] > 0 ? $busiest['hourLabel'] : '—',
            'peakHourJobs' => $busiest['jobsCount'],
            'topShopName' => ($topShop && $topShop['totalRevenue'] > 0) ? $topShop['name'] : ($state['shops'][0]['settings']['shopName'] ?? '—'),
            'topShopRevenue' => $topShop ? $topShop['totalRevenue'] : 0,
        ],
        'dailyVolume' => $dayBuckets,
        'shopsMeta' => $shopsMeta,
        'revenueTrendsPerShop' => $trendBuckets,
        'peakHours' => $peakHours,
    ]);
}

if ($route === '/api/admin/shops' && $method === 'POST') {
    requireAdminAuth($config);
    $body = getJsonBody();
    $name = substr(trim((string) ($body['shopName'] ?? '')), 0, 80);
    if ($name === '') sendJson(['error' => 'Shop name is required.'], 400);
    $baseSlug = slugify($name);
    $slug = $baseSlug;
    $c = 2;
    $existingSlugs = array_column($state['shops'], 'slug');
    while (in_array($slug, $existingSlugs, true)) {
        $slug = $baseSlug . '-' . $c++;
    }
    $tpl = $state['shops'][0]['settings'];
    $tpl['shopName'] = $name;
    $tpl['shopAddress'] = substr(trim((string) ($body['shopAddress'] ?? 'New Branch Counter')), 0, 150);
    $tpl['pricing']['bwPerPage'] = max(0.5, (float) ($body['bwPerPage'] ?? 2));
    $tpl['pricing']['colorPerPage'] = max(1.0, (float) ($body['colorPerPage'] ?? 10));
    $tpl['payment']['upiId'] = substr(trim((string) ($body['upiId'] ?? 'printflow@upi')), 0, 80);
    $tpl['payment']['upiPayeeName'] = substr(trim((string) ($body['upiPayeeName'] ?? $name)), 0, 80);
    $tpl['whatsapp']['businessNumber'] = substr(trim((string) ($body['whatsappNumber'] ?? '+919876543210')), 0, 24);
    $newShop = [
        'id' => 'shop-' . bin2hex(random_bytes(4)),
        'slug' => $slug,
        'active' => true,
        'createdAt' => gmdate('c'),
        'agentKey' => bin2hex(random_bytes(24)),
        'settings' => $tpl,
    ];
    $state['shops'][] = $newShop;
    saveState($pdo, $config, $state);
    sendJson(['shop' => $newShop], 201);
}

if (preg_match('#^/api/admin/shops/([^/]+)/rotate-agent-key$#', $route, $m) && $method === 'POST') {
    requireAdminAuth($config);
    foreach ($state['shops'] as &$sh) {
        if ($sh['id'] === $m[1]) {
            $sh['agentKey'] = bin2hex(random_bytes(24));
            saveState($pdo, $config, $state);
            sendJson(['shop' => $sh]);
        }
    }
    sendJson(['error' => 'Shop not found.'], 404);
}

if (preg_match('#^/api/admin/shops/([^/]+)/toggle$#', $route, $m) && $method === 'PATCH') {
    requireAdminAuth($config);
    foreach ($state['shops'] as &$sh) {
        if ($sh['id'] === $m[1]) {
            $sh['active'] = empty($sh['active']);
            saveState($pdo, $config, $state);
            sendJson(['shop' => $sh]);
        }
    }
    sendJson(['error' => 'Shop not found.'], 404);
}

if (preg_match('#^/api/admin/shops/([^/]+)$#', $route, $m) && $method === 'DELETE') {
    requireAdminAuth($config);
    if (count($state['shops']) <= 1) sendJson(['error' => 'At least one active shop must remain.'], 400);
    $state['shops'] = array_values(array_filter($state['shops'], fn($s) => $s['id'] !== $m[1]));
    saveState($pdo, $config, $state);
    sendJson(['ok' => true]);
}

if (preg_match('#^/api/admin/jobs/([^/]+)/action$#', $route, $m) && $method === 'POST') {
    requireAdminAuth($config);
    $body = getJsonBody();
    $action = (string) ($body['action'] ?? '');
    foreach ($state['jobs'] as &$job) {
        if ($job['id'] === $m[1]) {
            if ($action === 'mark_paid' || $action === 'print_now' || $action === 'reprint') {
                if ($job['paymentStatus'] !== 'paid') {
                    $job['paymentStatus'] = 'paid';
                    $job['paymentMethod'] = 'cash_counter';
                    $job['utrNumber'] = 'CASH-' . substr((string) time(), -6);
                    $job['paidAt'] = gmdate('c');
                }
                $job['printStatus'] = 'completed';
                $job['printedAt'] = gmdate('c');
                awardLoyaltyForJob($job, $state);
            } elseif ($action === 'mark_completed') {
                $job['printStatus'] = 'completed';
                $job['printedAt'] = gmdate('c');
                awardLoyaltyForJob($job, $state);
            } elseif ($action === 'cancel') {
                $job['printStatus'] = 'cancelled';
            }
            saveState($pdo, $config, $state);
            sendJson(['job' => $job]);
        }
    }
    sendJson(['error' => 'Job not found.'], 404);
}

if (preg_match('#^/api/admin/jobs/([^/]+)$#', $route, $m) && $method === 'DELETE') {
    requireAdminAuth($config);
    $state['jobs'] = array_values(array_filter($state['jobs'], fn($j) => $j['id'] !== $m[1]));
    saveState($pdo, $config, $state);
    sendJson(['ok' => true]);
}

if ($route === '/api/admin/settings' && $method === 'PUT') {
    requireAdminAuth($config);
    $body = getJsonBody();
    $targetId = (string) ($body['shopId'] ?? ($state['shops'][0]['id'] ?? ''));
    $allowedSections = array_flip(['shopName', 'shopTagline', 'shopAddress', 'gstNumber', 'pricing', 'payment', 'printers', 'whatsapp', 'formats', 'loyalty']);
    $filtered = array_intersect_key($body, $allowedSections);
    foreach ($state['shops'] as &$sh) {
        if ($sh['id'] === $targetId) {
            $sh['settings'] = array_replace_recursive($sh['settings'], $filtered);
            saveState($pdo, $config, $state);
            sendJson(['settings' => $sh['settings'], 'shop' => $sh]);
        }
    }
    sendJson(['error' => 'Shop not found.'], 404);
}

if ($route === '/api/admin/integration-status' && $method === 'GET') {
    requireAdminAuth($config);
    $base = getBaseUrl();
    sendJson([
        'whatsappTokenSet' => false,
        'whatsappVerifySet' => !empty($config['wa_verify_token']),
        'whatsappPhoneIdSet' => false,
        'paymentSecretSet' => !empty($config['payment_webhook_secret']),
        'adminEnvOverride' => false,
        'webhookUrl' => $base . '/api/webhook/whatsapp',
        'paymentWebhookUrl' => $base . '/api/webhook/payment',
    ]);
}

if ($route === '/api/webhook/payment' && $method === 'POST') {
    $secret = (string) ($config['payment_webhook_secret'] ?? '');
    if ($secret === '') sendJson(['error' => 'PAYMENT_WEBHOOK_SECRET is not configured.'], 503);
    $provided = (string) ($_SERVER['HTTP_X_WEBHOOK_SECRET'] ?? '');
    if (!hash_equals($secret, $provided)) sendJson(['error' => 'Invalid webhook signature.'], 401);
    $body = getJsonBody();
    $jid = (string) ($body['jobId'] ?? '');
    $utr = substr(trim((string) ($body['utrNumber'] ?? ('WH-' . time()))), 0, 40);
    foreach ($state['jobs'] as &$job) {
        if ($job['id'] === $jid || $job['code'] === $jid) {
            $shop = resolveShop($state, (string) $job['shopId']);
            $job['paymentStatus'] = 'paid';
            $job['paymentMethod'] = 'webhook';
            $job['utrNumber'] = $utr;
            $job['paidAt'] = gmdate('c');
            if (!empty($shop['settings']['payment']['autoPrintOnPayment']) && ($shop['settings']['printers']['bridgeMode'] ?? 'browser_auto') !== 'local_agent') {
                $job['printStatus'] = 'completed';
                $job['printedAt'] = gmdate('c');
                awardLoyaltyForJob($job, $state);
            } else {
                $job['printStatus'] = 'queued';
            }
            saveState($pdo, $config, $state);
            sendJson(['ok' => true, 'jobId' => $job['id'], 'status' => $job['printStatus']]);
        }
    }
    sendJson(['error' => 'Job not found.'], 404);
}

if ($route === '/api/admin/clients/windows' && $method === 'GET') {
    requireAdminAuth($config);
    $shop = resolveShop($state, (string) ($_GET['shopId'] ?? ''));
    $tplPath = BASE_DIR . '/windows-client/PrintFlow-Windows-Setup.ps1';
    if (!file_exists($tplPath)) sendJson(['error' => 'Windows client template folder not found in public_html/windows-client.'], 404);
    $san = fn(string $v): string => str_replace(['"', '`', '$', "\r", "\n"], ['', '', '', ' ', ' '], $v);
    $raw = (string) @file_get_contents($tplPath);
    $script = strtr($raw, [
        '__SERVER_URL__' => $san(getBaseUrl()),
        '__SHOP_ID__' => $san((string) $shop['id']),
        '__SHOP_NAME__' => $san((string) $shop['settings']['shopName']),
        '__AGENT_KEY__' => $san((string) $shop['agentKey']),
        '__BW_PRINTER__' => $san((string) $shop['settings']['printers']['bwPrinterName']),
        '__COLOR_PRINTER__' => $san((string) $shop['settings']['printers']['colorPrinterName']),
    ]);
    header('X-Content-Type-Options: nosniff');
    header('Content-Type: text/plain; charset=utf-8');
    header('Content-Disposition: attachment; filename="PrintFlow-' . $shop['slug'] . '-Windows-Setup.ps1"');
    echo $script;
    exit;
}

if ($route === '/api/admin/clients/android' && $method === 'GET') {
    requireAdminAuth($config);
    $shop = resolveShop($state, (string) ($_GET['shopId'] ?? ''));
    $fileType = (string) ($_GET['file'] ?? 'activity');
    if ($fileType === 'manifest') {
        $p = BASE_DIR . '/android-client/AndroidManifest.xml';
        if (!file_exists($p)) sendJson(['error' => 'AndroidManifest.xml template not found.'], 404);
        header('Content-Type: application/xml; charset=utf-8');
        header('Content-Disposition: attachment; filename="AndroidManifest.xml"');
        echo str_replace('__SHOP_NAME__', htmlspecialchars((string) $shop['settings']['shopName'], ENT_XML1), (string) @file_get_contents($p));
        exit;
    }
    if ($fileType === 'gradle') {
        $p = BASE_DIR . '/android-client/build.gradle.kts';
        if (!file_exists($p)) sendJson(['error' => 'build.gradle.kts template not found.'], 404);
        header('Content-Type: text/plain; charset=utf-8');
        header('Content-Disposition: attachment; filename="build.gradle.kts"');
        readfile($p);
        exit;
    }
    $p = BASE_DIR . '/android-client/MainActivity.kt';
    if (!file_exists($p)) sendJson(['error' => 'MainActivity.kt template not found.'], 404);
    $shopUrl = getBaseUrl() . '/?shop=' . urlencode((string) $shop['slug']);
    header('Content-Type: text/plain; charset=utf-8');
    header('Content-Disposition: attachment; filename="MainActivity-' . $shop['slug'] . '.kt"');
    echo str_replace('__SHOP_URL__', str_replace(['"', '\\', "\r", "\n"], '', $shopUrl), (string) @file_get_contents($p));
    exit;
}

sendJson(['error' => 'Unknown API endpoint: ' . $route], 404);
PHP;
                file_put_contents(API_DIR . '/index.php', $apiRouterCode);

                file_put_contents(LOCK_FILE, 'Installed on ' . gmdate('c') . "\n");
                $isLocked = true;
                $installedSuccess = true;
            } catch (Throwable $e) {
                $errors[] = 'Installation failed: ' . $e->getMessage();
            }
        }
    }
}
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PrintFlow AutoPrint — cPanel / PHP Hosting Installer</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 24px; }
    .wrap { max-width: 820px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 28px; }
    h1 { font-size: 22px; margin: 0 0 6px; }
    p.sub { color: #475569; font-size: 14px; margin: 0 0 22px; }
    .section { border-top: 1px solid #e2e8f0; padding-top: 18px; margin-top: 18px; }
    .req { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
    .ok { color: #15803d; font-weight: 600; }
    .warn { color: #b45309; font-weight: 600; }
    .fail { color: #b91c1c; font-weight: 600; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
    label { display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 5px; }
    input, select { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; }
    .btn { margin-top: 20px; background: #1d4ed8; color: #ffffff; border: 0; padding: 12px 20px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; display: inline-block; text-decoration: none; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .alert { padding: 12px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 16px; line-height: 1.6; }
    .alert-err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
    .alert-ok { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>PrintFlow AutoPrint — cPanel PHP Installer (v<?= h(INSTALLER_VERSION) ?>)</h1>
    <p class="sub">Full-stack installer for cPanel / Apache / PHP 8+ (SQLite or MySQL) with complete Multi-Shop, Loyalty, Analytics, WhatsApp &amp; Print Agent APIs.</p>

    <?php if (!empty($errors)): ?>
      <div class="alert alert-err">
        <?php foreach ($errors as $err): ?>
          <div>• <?= h($err) ?></div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>

    <?php if ($installedSuccess || $isLocked): ?>
      <div class="alert alert-ok">
        <strong>Installation Complete &amp; Locked!</strong><br />
        <code>.htaccess</code>, <code>config/app.php</code>, protected <code>uploads/.htaccess</code>, and full <code>api/index.php</code> backend are active.<br />
        <strong>Security Step:</strong> Delete <code>install.php</code> from <code>public_html/</code> now.<br />
        <a class="btn" href="./">Open PrintFlow App</a>
      </div>
    <?php else: ?>
      <div class="section">
        <h2 style="font-size: 15px; margin: 0 0 10px;">1. Server Requirements</h2>
        <?php foreach ($requirements as $req): ?>
          <div class="req">
            <span><?= h($req['label']) ?> <small style="color:#64748b">(<?= h($req['detail']) ?>)</small></span>
            <?php if ($req['ok']): ?>
              <span class="ok">PASS</span>
            <?php elseif (!$req['required']): ?>
              <span class="warn">OPTIONAL</span>
            <?php else: ?>
              <span class="fail">FAIL</span>
            <?php endif; ?>
          </div>
        <?php endforeach; ?>
      </div>

      <form method="post">
        <input type="hidden" name="csrf_token" value="<?= h($csrfToken) ?>" />

        <div class="section">
          <h2 style="font-size: 15px; margin: 0 0 12px;">2. Database Configuration</h2>
          <div class="grid">
            <div>
              <label for="db_driver">Database Engine</label>
              <select id="db_driver" name="db_driver">
                <option value="sqlite">SQLite (Zero-Config Local File)</option>
                <option value="mysql">MySQL / MariaDB (cPanel)</option>
              </select>
            </div>
            <div>
              <label for="db_host">MySQL Host</label>
              <input id="db_host" name="db_host" value="<?= h((string) ($_POST['db_host'] ?? '127.0.0.1')) ?>" />
            </div>
            <div>
              <label for="db_port">MySQL Port</label>
              <input id="db_port" name="db_port" type="number" value="<?= h((string) ($_POST['db_port'] ?? '3306')) ?>" />
            </div>
            <div>
              <label for="db_name">Database Name</label>
              <input id="db_name" name="db_name" value="<?= h((string) ($_POST['db_name'] ?? 'printflow')) ?>" />
            </div>
            <div>
              <label for="db_user">Database Username</label>
              <input id="db_user" name="db_user" value="<?= h((string) ($_POST['db_user'] ?? '')) ?>" />
            </div>
            <div>
              <label for="db_pass">Database Password</label>
              <input id="db_pass" name="db_pass" type="password" value="" />
            </div>
          </div>
        </div>

        <div class="section">
          <h2 style="font-size: 15px; margin: 0 0 12px;">3. Shop, UPI &amp; Admin Setup</h2>
          <div class="grid">
            <div>
              <label for="shop_name">Shop Name</label>
              <input id="shop_name" name="shop_name" required value="<?= h((string) ($_POST['shop_name'] ?? 'PrintFlow Digital Hub')) ?>" />
            </div>
            <div>
              <label for="shop_address">Shop Address</label>
              <input id="shop_address" name="shop_address" value="<?= h((string) ($_POST['shop_address'] ?? 'Shop 14, Ground Floor, Tech Plaza')) ?>" />
            </div>
            <div>
              <label for="upi_id">Merchant UPI ID</label>
              <input id="upi_id" name="upi_id" required value="<?= h((string) ($_POST['upi_id'] ?? 'printflow@upi')) ?>" />
            </div>
            <div>
              <label for="bw_rate">B&amp;W Rate (₹/page)</label>
              <input id="bw_rate" name="bw_rate" type="number" step="0.5" value="<?= h((string) ($_POST['bw_rate'] ?? '2')) ?>" />
            </div>
            <div>
              <label for="color_rate">Color Rate (₹/page)</label>
              <input id="color_rate" name="color_rate" type="number" step="0.5" value="<?= h((string) ($_POST['color_rate'] ?? '10')) ?>" />
            </div>
            <div>
              <label for="wa_number">WhatsApp Business Number</label>
              <input id="wa_number" name="wa_number" value="<?= h((string) ($_POST['wa_number'] ?? '+919876543210')) ?>" />
            </div>
            <div>
              <label for="wa_verify_token">WhatsApp Verify Token (Optional)</label>
              <input id="wa_verify_token" name="wa_verify_token" value="<?= h((string) ($_POST['wa_verify_token'] ?? '')) ?>" />
            </div>
            <div>
              <label for="admin_passcode">Admin Passcode (Min 4 chars)</label>
              <input id="admin_passcode" name="admin_passcode" type="password" required minlength="4" />
            </div>
          </div>
        </div>

        <button class="btn" type="submit" <?= $allReqPassed ? '' : 'disabled' ?>>
          Install PrintFlow on cPanel Hosting
        </button>
      </form>
    <?php endif; ?>
  </div>
</body>
</html>
