# CryptoChat

Chat cifrado de ponta a ponta (AES-256-GCM) que roda 100% no navegador, com dois modos:

- **Normal** — conversas persistentes com lista de contatos adicionados por código.
- **Privado** — sala efêmera cifrada, apagada automaticamente ao fechar o site.

## Como funciona

- **Transporte:** WebRTC P2P via [PeerJS](https://peerjs.com) (só a sinalização passa pelo servidor público).
- **Criptografia:** AES-256-GCM, chave derivada com PBKDF2 (SHA-256 · 150.000 iterações).
- **Sem backend:** site estático — perfeito para GitHub Pages.

## Estrutura

```
.
├── index.html
├── README.md
├── css/
│   └── style.css
└── js/
    ├── crypto.js
    ├── storage.js
    ├── peers.js
    └── app.js
```

## Deploy no GitHub Pages

1. Crie um repositório no GitHub.
2. Faça upload de todos os arquivos (mantendo as pastas).
3. Vá em **Settings → Pages**.
4. Em **Source**, escolha `Deploy from a branch` → `main` → `/ (root)`.
5. Salve. Em segundos o site fica disponível em `https://SEU-USUARIO.github.io/SEU-REPO/`.

> **HTTPS é obrigatório** para `crypto.subtle` e WebRTC. GitHub Pages já fornece.

## Uso

### Modo Normal
1. Toque em **Normal**.
2. Seu código pessoal aparece no topo. Compartilhe com quem quer conversar.
3. Toque em **Adicionar**, digite o código da outra pessoa.
4. O contato aparece na barra horizontal. Toque nele para conversar.
5. As mensagens ficam salvas neste navegador (localStorage).

### Modo Privado
1. Toque em **Privado**.
2. Um código é gerado. Compartilhe.
3. A outra pessoa entra em **Privado**, digita seu código e toca em **Conectar**.
   (Ou o contrário: você digita o código dela em **Conectar com código**.)
4. Assim que a conexão abre, o chat aparece. As mensagens **somem** ao fechar a aba.

## Limitações

- O servidor público do PeerJS faz apenas a **sinalização**; as mensagens trafegam direto entre navegadores.
- Sem TURN configurado, redes muito restritivas (NAT simétrico, algumas operadoras móveis) podem falhar. Para produção, configure um TURN próprio em `js/peers.js`.
- O código é usado como identificador. Não há verificação de identidade — trate como um "apelido".

## Segurança

- A chave nunca é transmitida: é derivada localmente do segredo compartilhado (o código).
- Cada mensagem usa IV aleatório de 96 bits.
- O transporte WebRTC já é cifrado por DTLS; a camada AES-GCM é adicional.

## Licença

MIT
