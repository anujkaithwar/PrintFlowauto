<?php
/**
 * PrintFlow AutoPrint — PHP 8+ Hosting Installer (install.php)
 * Upload this single file to your cPanel / Apache / Nginx PHP web root (e.g. public_html/)
 * and open https://yourdomain.com/install.php in your browser.
 */

declare(strict_types=1);

session_set_cookie_params([
    'httponly' => true,
    'samesite' => 'Lax',
    'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
]);
session_start();

define('INSTALLER_VERSION', '1.0.0');
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

// Check PHP Environment Requirements
$requirements = [
    [
        'label' => 'PHP Version (>= 8.0)',
        'ok' => version_compare(PHP_VERSION, '8.0.0', '>='),
        'detail' => 'Detected PHP ' . PHP_VERSION,
    ],
    [
        'label' => 'PDO Extension (MySQL or SQLite)',
        'ok' => extension_loaded('pdo') && (extension_loaded('pdo_mysql') || extension_loaded('pdo_sqlite')),
        'detail' => implode(', ', array_filter([
            extension_loaded('pdo_mysql') ? 'pdo_mysql' : '',
            extension_loaded('pdo_sqlite') ? 'pdo_sqlite' : '',
        ])) ?: 'Missing pdo_mysql / pdo_sqlite',
    ],
    [
        'label' => 'cURL & OpenSSL Extensions',
        'ok' => extension_loaded('curl') && extension_loaded('openssl'),
        'detail' => (extension_loaded('curl') ? 'curl OK' : 'curl missing') . ' / ' . (extension_loaded('openssl') ? 'openssl OK' : 'openssl missing'),
    ],
    [
        'label' => 'JSON & Fileinfo Extensions',
        'ok' => extension_loaded('json') && extension_loaded('fileinfo'),
        'detail' => (extension_loaded('json') ? 'json OK' : 'json missing') . ' / ' . (extension_loaded('fileinfo') ? 'fileinfo OK' : 'fileinfo missing'),
    ],
    [
        'label' => 'Root Directory Writable',
        'ok' => is_writable(BASE_DIR),
        'detail' => is_writable(BASE_DIR) ? BASE_DIR : 'Grant write permission (0755) to ' . BASE_DIR,
    ],
];

$allReqPassed = !in_array(false, array_column($requirements, 'ok'), true);
$errors = [];
$installedSuccess = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$isLocked) {
    $postedCsrf = (string) ($_POST['csrf_token'] ?? '');
    if (!hash_equals($csrfToken, $postedCsrf)) {
        $errors[] = 'Invalid security token. Please refresh the page and try again.';
    } elseif (!$allReqPassed) {
        $errors[] = 'Please resolve the server requirement checks before installing.';
    } else {
        $dbDriver = ($_POST['db_driver'] ?? 'sqlite') === 'mysql' ? 'mysql' : 'sqlite';
        $dbHost = trim((string) ($_POST['db_host'] ?? '127.0.0.1'));
        $dbPort = max(1, (int) ($_POST['db_port'] ?? 3306));
        $dbName = trim((string) ($_POST['db_name'] ?? 'printflow'));
        $dbUser = trim((string) ($_POST['db_user'] ?? ''));
        $dbPass = (string) ($_POST['db_pass'] ?? '');

        $shopName = trim((string) ($_POST['shop_name'] ?? 'PrintFlow Digital Hub'));
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
        if (strlen($adminPasscode) < 6) {
            $errors[] = 'Admin Passcode must be at least 6 characters.';
        }
        if ($dbDriver === 'mysql' && ($dbHost === '' || $dbName === '' || $dbUser === '')) {
            $errors[] = 'MySQL Host, Database Name, and Username are required.';
        }

        if (empty($errors)) {
            try {
                // Ensure directories exist
                foreach ([STORAGE_DIR, CONFIG_DIR, UPLOAD_DIR, API_DIR] as $dir) {
                    if (!is_dir($dir) && !mkdir($dir, 0755, true)) {
                        throw new RuntimeException('Unable to create directory: ' . $dir);
                    }
                }

                // Connect PDO (MySQL or SQLite)
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

                // Create schema tables
                $idCol = $dbDriver === 'mysql'
                    ? 'id VARCHAR(64) PRIMARY KEY'
                    : 'id TEXT PRIMARY KEY';

                $pdo->exec("CREATE TABLE IF NOT EXISTS print_jobs (
                    {$idCol},
                    code VARCHAR(24) NOT NULL,
                    pin VARCHAR(12) NOT NULL,
                    source VARCHAR(24) NOT NULL DEFAULT 'web_upload',
                    customer_name VARCHAR(100) NOT NULL DEFAULT 'Walk-in Customer',
                    customer_phone VARCHAR(30) NOT NULL DEFAULT '',
                    original_filename VARCHAR(255) NOT NULL,
                    stored_filename VARCHAR(255) NOT NULL,
                    mime_type VARCHAR(120) NOT NULL,
                    detected_pages INT NOT NULL DEFAULT 1,
                    color_mode VARCHAR(16) NOT NULL DEFAULT 'bw',
                    paper_size VARCHAR(24) NOT NULL DEFAULT 'A4',
                    sides VARCHAR(16) NOT NULL DEFAULT 'single',
                    copies INT NOT NULL DEFAULT 1,
                    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                    payment_status VARCHAR(24) NOT NULL DEFAULT 'pending',
                    utr_number VARCHAR(64) DEFAULT NULL,
                    print_status VARCHAR(32) NOT NULL DEFAULT 'awaiting_payment',
                    created_at VARCHAR(40) NOT NULL
                )");

                $pdo->exec("CREATE TABLE IF NOT EXISTS business_settings (
                    setting_key VARCHAR(64) PRIMARY KEY,
                    setting_value TEXT NOT NULL
                )");

                $pdo->exec("CREATE TABLE IF NOT EXISTS whatsapp_logs (
                    {$idCol},
                    direction VARCHAR(16) NOT NULL,
                    phone VARCHAR(30) NOT NULL,
                    sender_name VARCHAR(100) NOT NULL,
                    message_text TEXT NOT NULL,
                    job_code VARCHAR(24) DEFAULT NULL,
                    created_at VARCHAR(40) NOT NULL
                )");

                // Seed initial settings via prepared statements
                $settingsMap = [
                    'shop_name' => $shopName,
                    'upi_id' => $upiId,
                    'bw_per_page' => number_format($bwRate, 2, '.', ''),
                    'color_per_page' => number_format($colorRate, 2, '.', ''),
                    'whatsapp_number' => $waNumber,
                    'whatsapp_verify_token' => $waVerifyToken ?: bin2hex(random_bytes(12)),
                    'auto_print_on_payment' => '1',
                    'admin_passcode_hash' => password_hash($adminPasscode, PASSWORD_BCRYPT),
                ];

                $stmt = $dbDriver === 'mysql'
                    ? $pdo->prepare('INSERT INTO business_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)')
                    : $pdo->prepare('INSERT OR REPLACE INTO business_settings (setting_key, setting_value) VALUES (?, ?)');

                foreach ($settingsMap as $k => $v) {
                    $stmt->execute([$k, $v]);
                }

                // Write config/app.php safely using var_export
                $configExport = [
                    'db_driver' => $dbDriver,
                    'db_host' => $dbHost,
                    'db_port' => $dbPort,
                    'db_name' => $dbName,
                    'db_user' => $dbUser,
                    'db_pass' => $dbPass,
                    'sqlite_path' => STORAGE_DIR . '/printflow.sqlite',
                    'app_secret' => bin2hex(random_bytes(32)),
                    'installed_at' => gmdate('c'),
                ];
                $configFileContent = "<?php\nreturn " . var_export($configExport, true) . ";\n";
                file_put_contents(CONFIG_DIR . '/app.php', $configFileContent);
                @chmod(CONFIG_DIR . '/app.php', 0640);

                // Protect uploads/ and storage/ from script execution or directory listing
                $denyScriptHtaccess = "Options -Indexes\n<FilesMatch \"\\.(php|phtml|php\\d|phar|cgi|pl|py|sh)$\">\n  Require all denied\n</FilesMatch>\n";
                file_put_contents(UPLOAD_DIR . '/.htaccess', $denyScriptHtaccess);
                file_put_contents(STORAGE_DIR . '/.htaccess', "Require all denied\n");
                file_put_contents(CONFIG_DIR . '/.htaccess', "Require all denied\n");

                // Write standalone PHP API router (api/index.php)
                $apiRouterCode = <<<'PHP'
<?php
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$config = require __DIR__ . '/../config/app.php';
$dsn = $config['db_driver'] === 'mysql'
    ? sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $config['db_host'], $config['db_port'], $config['db_name'])
    : 'sqlite:' . $config['sqlite_path'];

$pdo = new PDO($dsn, $config['db_user'] ?: null, $config['db_pass'] ?: null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
]);

function getSetting(PDO $pdo, string $key, string $default = ''): string {
    $s = $pdo->prepare('SELECT setting_value FROM business_settings WHERE setting_key = ?');
    $s->execute([$key]);
    $row = $s->fetch();
    return $row ? (string) $row['setting_value'] : $default;
}

$action = (string) ($_GET['action'] ?? 'health');

if ($action === 'health') {
    echo json_encode(['status' => 'ok', 'shop' => getSetting($pdo, 'shop_name', 'PrintFlow')]);
    exit;
}

if ($action === 'whatsapp_webhook' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $mode = (string) ($_GET['hub_mode'] ?? $_GET['hub.mode'] ?? '');
    $token = (string) ($_GET['hub_verify_token'] ?? $_GET['hub.verify_token'] ?? '');
    $challenge = (string) ($_GET['hub_challenge'] ?? $_GET['hub.challenge'] ?? '');
    $expected = getSetting($pdo, 'whatsapp_verify_token');
    if ($mode === 'subscribe' && $expected !== '' && hash_equals($expected, $token)) {
        header('Content-Type: text/plain');
        echo $challenge;
        exit;
    }
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

if ($action === 'upload' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['error' => 'Valid file upload required.']);
        exit;
    }
    $allowed = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'webp', 'txt', 'csv'];
    $origName = basename((string) $_FILES['file']['name']);
    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
    if (!in_array($ext, $allowed, true)) {
        http_response_code(400);
        echo json_encode(['error' => 'Unsupported file extension.']);
        exit;
    }
    $storedName = bin2hex(random_bytes(16)) . '.' . $ext;
    $dest = __DIR__ . '/../uploads/' . $storedName;
    if (!move_uploaded_file($_FILES['file']['tmp_name'], $dest)) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to save uploaded file.']);
        exit;
    }
    $colorMode = ($_POST['colorMode'] ?? 'bw') === 'color' ? 'color' : 'bw';
    $copies = max(1, min(200, (int) ($_POST['copies'] ?? 1)));
    $pages = max(1, (int) ($_POST['pages'] ?? 1));
    $rate = (float) getSetting($pdo, $colorMode === 'color' ? 'color_per_page' : 'bw_per_page', $colorMode === 'color' ? '10' : '2');
    $total = round($pages * $copies * $rate, 2);

    $id = bin2hex(random_bytes(16));
    $code = 'PF-' . random_int(1000, 9999);
    $pin = (string) random_int(100000, 999999);

    $ins = $pdo->prepare('INSERT INTO print_jobs (id, code, pin, original_filename, stored_filename, mime_type, detected_pages, color_mode, copies, total_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $ins->execute([
        $id, $code, $pin, $origName, $storedName,
        (string) ($_FILES['file']['type'] ?: 'application/octet-stream'),
        $pages, $colorMode, $copies, $total, gmdate('c')
    ]);

    $upiUri = 'upi://pay?' . http_build_query([
        'pa' => getSetting($pdo, 'upi_id', 'printflow@upi'),
        'pn' => getSetting($pdo, 'shop_name', 'PrintFlow'),
        'am' => number_format($total, 2, '.', ''),
        'cu' => 'INR',
        'tn' => 'Print ' . $code,
    ]);

    echo json_encode([
        'id' => $id,
        'code' => $code,
        'pin' => $pin,
        'totalAmount' => $total,
        'upiUri' => $upiUri,
    ]);
    exit;
}

http_response_code(404);
echo json_encode(['error' => 'Unknown endpoint']);
PHP;
                file_put_contents(API_DIR . '/index.php', $apiRouterCode);

                // Create lock file so installer cannot be re-run
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
  <title>PrintFlow AutoPrint — PHP Hosting Installer</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 24px; }
    .wrap { max-width: 780px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 28px; }
    h1 { font-size: 22px; margin: 0 0 6px; }
    p.sub { color: #475569; font-size: 14px; margin: 0 0 22px; }
    .section { border-top: 1px solid #e2e8f0; padding-top: 18px; margin-top: 18px; }
    .req { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
    .ok { color: #15803d; font-weight: 600; }
    .fail { color: #b91c1c; font-weight: 600; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
    label { display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 5px; }
    input, select { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; }
    .btn { margin-top: 20px; background: #1d4ed8; color: #ffffff; border: 0; padding: 12px 20px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .alert { padding: 12px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 16px; }
    .alert-err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
    .alert-ok { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>PrintFlow AutoPrint — PHP Installer (v<?= h(INSTALLER_VERSION) ?>)</h1>
    <p class="sub">Automated setup wizard for cPanel / Apache / PHP 8+ shared &amp; VPS hosting.</p>

    <?php if (!empty($errors)): ?>
      <div class="alert alert-err">
        <?php foreach ($errors as $err): ?>
          <div>• <?= h($err) ?></div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>

    <?php if ($installedSuccess || $isLocked): ?>
      <div class="alert alert-ok">
        <strong>Installation Locked &amp; Ready!</strong><br />
        Database tables, <code>config/app.php</code>, protected <code>uploads/.htaccess</code>, and <code>api/index.php</code> are configured.<br />
        <strong>Security Step:</strong> Delete <code>install.php</code> from your server now. Test API health at <code>api/index.php?action=health</code>.
      </div>
    <?php else: ?>
      <div class="section">
        <h2 style="font-size: 15px; margin: 0 0 10px;">1. Server Requirements</h2>
        <?php foreach ($requirements as $req): ?>
          <div class="req">
            <span><?= h($req['label']) ?> <small style="color:#64748b">(<?= h($req['detail']) ?>)</small></span>
            <span class="<?= $req['ok'] ? 'ok' : 'fail' ?>"><?= $req['ok'] ? 'PASS' : 'FAIL' ?></span>
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
              <label for="admin_passcode">Admin Passcode (Min 6 chars)</label>
              <input id="admin_passcode" name="admin_passcode" type="password" required minlength="6" />
            </div>
          </div>
        </div>

        <button class="btn" type="submit" <?= $allReqPassed ? '' : 'disabled' ?>>
          Install PrintFlow on PHP Hosting
        </button>
      </form>
    <?php endif; ?>
  </div>
</body>
</html>
