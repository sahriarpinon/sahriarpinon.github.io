<?php
declare(strict_types=1);

const SONGS_FILE = __DIR__ . '/songs.json';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, X-Firebase-Auth, Content-Type');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function is_list_array($value): bool
{
    if (!is_array($value)) {
        return false;
    }
    $expectedKey = 0;
    foreach ($value as $key => $_item) {
        if ($key !== $expectedKey) {
            return false;
        }
        $expectedKey++;
    }
    return true;
}

function firebase_project_id(): string
{
    $appConfigPath = __DIR__ . '/app.js';
    $appSource = @file_get_contents($appConfigPath);
    if ($appSource === false
        || !preg_match('/const\s+firebaseConfig\s*=\s*\{([\s\S]*?)\};/', $appSource, $configMatch)
        || !preg_match('/\bprojectId\s*:\s*[\'"]([^\'"]+)[\'"]/', $configMatch[1], $projectMatch)) {
        throw new RuntimeException('Could not read projectId from the active firebaseConfig in app.js.');
    }
    return $projectMatch[1];
}

function base64url_decode_strict(string $value): string
{
    $decoded = base64_decode(strtr($value, '-_', '+/') . str_repeat('=', (4 - strlen($value) % 4) % 4), true);
    if ($decoded === false) {
        throw new RuntimeException('Invalid Firebase token encoding.');
    }
    return $decoded;
}

function firebase_signing_certificates(): array
{
    static $certificates = null;
    if ($certificates !== null) {
        return $certificates;
    }

    $url = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
    $context = stream_context_create(['http' => ['timeout' => 8, 'ignore_errors' => true]]);
    $response = @file_get_contents($url, false, $context);
    if ($response === false && function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8,
        ]);
        $response = curl_exec($curl);
        curl_close($curl);
    }
    if ($response === false) {
        throw new RuntimeException('Could not retrieve Firebase token verification certificates.');
    }

    $certificates = json_decode($response, true);
    if (!is_array($certificates) || !$certificates) {
        throw new RuntimeException('Firebase token verification certificates were invalid.');
    }
    return $certificates;
}

function verify_firebase_token(): array
{
    $projectId = firebase_project_id();
    $authorization = $_SERVER['HTTP_AUTHORIZATION']
        ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
        ?? '';
    if (!$authorization && function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strtolower($name) === 'authorization') {
                $authorization = $value;
                break;
            }
        }
    }

    if (preg_match('/^Bearer\s+(.+)$/i', $authorization, $matches)) {
        $token = trim($matches[1]);
    } else {
        $token = trim($_SERVER['HTTP_X_FIREBASE_AUTH'] ?? '');
        if (!$token && function_exists('getallheaders')) {
            foreach (getallheaders() as $name => $value) {
                if (strtolower($name) === 'x-firebase-auth') {
                    $token = trim($value);
                    break;
                }
            }
        }
    }

    if ($token === '') {
        respond(401, ['error' => 'Sign in is required.']);
    }

    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        respond(401, ['error' => 'Invalid Firebase ID token.']);
    }

    try {
        $header = json_decode(base64url_decode_strict($parts[0]), true, 512, JSON_THROW_ON_ERROR);
        $claims = json_decode(base64url_decode_strict($parts[1]), true, 512, JSON_THROW_ON_ERROR);
        if (($header['alg'] ?? '') !== 'RS256' || empty($header['kid'])) {
            respond(401, ['error' => 'Unsupported Firebase ID token.']);
        }

        $certificates = firebase_signing_certificates();
        $certificate = $certificates[$header['kid']] ?? null;
        if (!$certificate) {
            respond(401, ['error' => 'Firebase token signing key was not recognized. Sign in again.']);
        }
        $publicKey = openssl_pkey_get_public($certificate);
        $signature = base64url_decode_strict($parts[2]);
        $verified = $publicKey !== false && openssl_verify(
            $parts[0] . '.' . $parts[1],
            $signature,
            $publicKey,
            OPENSSL_ALGO_SHA256
        ) === 1;
        if (!$verified) {
            respond(401, ['error' => 'Firebase ID token signature is invalid.']);
        }
    } catch (Throwable $error) {
        respond(503, ['error' => $error->getMessage()]);
    }

    $now = time();
    if (($claims['aud'] ?? '') !== $projectId
        || ($claims['iss'] ?? '') !== 'https://securetoken.google.com/' . $projectId
        || !isset($claims['sub'])
        || (int)($claims['exp'] ?? 0) <= $now
        || (int)($claims['iat'] ?? 0) > $now
        || ($claims['email_verified'] ?? false) !== true) {
        respond(401, ['error' => 'Firebase ID token is expired or belongs to another project/account.']);
    }

    return $claims;
}

function read_songs_file(): array
{
    if (!is_file(SONGS_FILE)) {
        return [];
    }
    $contents = file_get_contents(SONGS_FILE);
    $songs = json_decode($contents === false ? '' : $contents, true);
    if (!is_list_array($songs)) {
        throw new RuntimeException('songs.json is not a valid JSON array.');
    }
    return $songs;
}

function write_songs_file(array $songs): void
{
    $json = json_encode($songs, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($json === false) {
        throw new RuntimeException('Could not encode song data as JSON.');
    }

    $temporaryFile = SONGS_FILE . '.' . bin2hex(random_bytes(6)) . '.tmp';
    if (file_put_contents($temporaryFile, $json . "\n", LOCK_EX) === false) {
        throw new RuntimeException('MAMP could not write the JSON file. Check folder permissions.');
    }
    if (!rename($temporaryFile, SONGS_FILE)) {
        @unlink($temporaryFile);
        throw new RuntimeException('MAMP could not replace songs.json. Check folder permissions.');
    }
}

$claims = verify_firebase_token();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($method === 'GET' || $method === 'HEAD') {
        if (!is_file(SONGS_FILE)) {
            respond(200, ['exists' => false, 'songs' => []]);
        }
        respond(200, ['exists' => true, 'songs' => read_songs_file()]);
    }

    if ($method !== 'POST') {
        header('Allow: GET, HEAD, POST, OPTIONS');
        respond(405, ['error' => 'Method not allowed: ' . $method, 'method' => $method]);
    }
    if (($claims['admin'] ?? false) !== true) {
        respond(403, ['error' => 'Only an admin can update songs.json.']);
    }

    $rawBody = file_get_contents('php://input');
    if ($rawBody === false || strlen($rawBody) > 20 * 1024 * 1024) {
        respond(413, ['error' => 'Request body is missing or too large.']);
    }
    $payload = json_decode($rawBody, true);
    if (!is_array($payload)) {
        respond(400, ['error' => 'Request body must be valid JSON.']);
    }

    $action = $payload['action'] ?? '';
    if ($action === 'replace') {
        $songs = $payload['songs'] ?? null;
        if (!is_list_array($songs)) {
            respond(400, ['error' => 'The songs field must be an array.']);
        }
        foreach ($songs as $song) {
            if (!is_array($song) || empty($song['id'])) {
                respond(400, ['error' => 'Every song must include its Firestore document id in the id field.']);
            }
        }
        write_songs_file($songs);
        respond(200, ['ok' => true, 'count' => count($songs)]);
    }

    if ($action === 'upsert') {
        $song = $payload['song'] ?? null;
        if (!is_array($song) || empty($song['id'])) {
            respond(400, ['error' => 'A song with a Firestore document id is required.']);
        }
        $songs = read_songs_file();
        $found = false;
        foreach ($songs as $index => $existingSong) {
            if (($existingSong['id'] ?? null) === $song['id']) {
                $songs[$index] = $song;
                $found = true;
                break;
            }
        }
        if (!$found) {
            $songs[] = $song;
        }
        write_songs_file(array_values($songs));
        respond(200, ['ok' => true, 'count' => count($songs)]);
    }

    respond(400, ['error' => 'Unknown songs.json action.']);
} catch (Throwable $error) {
    respond(500, ['error' => $error->getMessage()]);
}
