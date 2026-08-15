# Provider contract tests

The local synthetic breach adapter covers success, empty, duplicate, malformed, hostile, timeout, authentication, rate-limit, outage, pagination, and schema-change behavior. Tests assert that feature, kill-switch, environment, verification, schema, result, and zero-cost gates fail closed. No provider test uses a live credential, personal identifier, captured response, or network call.
