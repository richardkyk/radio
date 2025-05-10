[req]
default_bits = 2048
prompt = no
default_md = sha256
req_extensions = req_ext
distinguished_name = dn

[dn]
CN = {{CERT_IP}}

[req_ext]
subjectAltName = @alt_names

[alt_names]
IP.1 = {{CERT_IP}}
