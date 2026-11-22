const orderRequest = {
  service: 123,
  link: "https://example.com/campaign",
  quantity: 1000,
  request_id: "c56a4180-65aa-42ec-a945-5fd21dec0538",
  total_inr: 120,
};

const serviceResponse = {
  services: [{
    service: 123,
    name: "Example service",
    category: "Example category",
    type: "Default",
    minimum: 100,
    maximum: 10000,
    rate: 120,
    currency: "INR",
  }],
};

function phpExample(endpoint: string) {
  return [
    "<?php",
    '$key = getenv("VOXX_API_KEY");',
    'if (!$key) { throw new RuntimeException("Set VOXX_API_KEY on your server."); }',
    '$base = ' + JSON.stringify(endpoint) + ';',
    "",
    "function voxxRequest(string $url, string $key, ?array $body = null): array {",
    '    $headers = ["Authorization: Bearer " . $key, "Accept: application/json"];',
    "    $ch = curl_init($url);",
    "    $options = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15];",
    "    if ($body !== null) {",
    '        $headers[] = "Content-Type: application/json";',
    "        $options[CURLOPT_POST] = true;",
    "        $options[CURLOPT_POSTFIELDS] = json_encode($body, JSON_THROW_ON_ERROR);",
    "    }",
    "    $options[CURLOPT_HTTPHEADER] = $headers;",
    "    curl_setopt_array($ch, $options);",
    "    $raw = curl_exec($ch);",
    "    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);",
    "    curl_close($ch);",
    "    if ($raw === false || $status < 200 || $status >= 300) {",
    '        throw new RuntimeException("VOXX request failed (HTTP " . $status . ").");',
    "    }",
    "    return json_decode($raw, true, 512, JSON_THROW_ON_ERROR);",
    "}",
    "",
    '$catalogue = voxxRequest($base . "?services=1", $key);',
    'echo json_encode($catalogue, JSON_PRETTY_PRINT);',
    "",
    "// To create an order, supply the live service and quoted total.",
    "// Store a unique request UUID with the order and reuse it on retries.",
    "// $created = voxxRequest($base, $key, [",
    '//     "service" => 123, "link" => "https://example.com/campaign",',
    '//     "quantity" => 1000, "total_inr" => 120,',
    '//     "request_id" => $savedRequestId,',
    "// ]);",
  ].join("\n");
}

export function ResellerApiGuide({ endpoint }: { endpoint: string }) {
  return (
    <>
      <h2>Reseller API</h2>
      <label>
        API endpoint
        <input readOnly value={endpoint} onFocus={(event) => event.currentTarget.select()} />
      </label>
      <p>Send your API key in the <code>Authorization: Bearer YOUR_API_KEY</code> header. Keep it on your server.</p>
      <details>
        <summary>Requests and JSON responses</summary>
        <h3>List services</h3>
        <p><code>GET /api/reseller?services=1</code> · No request body</p>
        <pre tabIndex={0}>{JSON.stringify(serviceResponse, null, 2)}</pre>
        <h3>Create an order</h3>
        <p><code>POST /api/reseller</code> · <code>Content-Type: application/json</code></p>
        <pre tabIndex={0}>{JSON.stringify(orderRequest, null, 2)}</pre>
        <p>Use the catalogue rate per 1,000 units to calculate the total in INR, rounded to two decimals. Generate a new UUID for each order and keep it for retries.</p>
        <pre tabIndex={0}>{JSON.stringify({ id: "276abd5b-db76-4c56-99e4-955f75b0ea18" }, null, 2)}</pre>
        <h3>List recent orders</h3>
        <p><code>GET /api/reseller</code> · No request body</p>
        <pre tabIndex={0}>{JSON.stringify({
          orders: [{
            id: "276abd5b-db76-4c56-99e4-955f75b0ea18", service_id: 123, quantity: 1000,
            total_inr: 120, state: "Submitted", provider_status: null, created_at: "2026-01-01T00:00:00Z",
          }],
        }, null, 2)}</pre>
        <h3>Error response</h3>
        <pre tabIndex={0}>{JSON.stringify({ error: "Invalid key or rate limit reached" }, null, 2)}</pre>
      </details>
      <details>
        <summary>PHP example</summary>
        <pre tabIndex={0}>{phpExample(endpoint)}</pre>
      </details>
    </>
  );
}
