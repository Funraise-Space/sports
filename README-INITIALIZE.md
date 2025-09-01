# Script de Inicialización - Sports Contract

Script para inicializar el contrato de Sports en Solana devnet.

## 🚀 Uso Rápido

### 1. Configurar Variables de Entorno
```bash
# Copiar archivo de ejemplo
cp .env.example .env

# Editar con tus valores
nano .env
```

### 2. Ejecutar Inicialización
```bash
# Desde el directorio /sports
npx ts-node scripts/initialize.ts
```

## ⚙️ Variables de Entorno

### Requeridas
- `OWNER_PRIVATE_KEY`: Clave privada del owner en formato base58
- `SOLANA_RPC_URL`: URL del RPC de Solana (devnet por defecto)

### Opcionales
- `USDC_MINT`: Dirección del mint USDC (usa devnet por defecto)
- `TEAM_PRICE_A`: Precio del Pack A en micro USDC (10M = $10)
- `TEAM_PRICE_B`: Precio del Pack B en micro USDC (15M = $15)
- `TEAM_PRICE_C`: Precio del Pack C en micro USDC (20M = $20)
- `NFT_IMAGE_URL`: URL base para imágenes de NFTs

## 📋 Proceso de Inicialización

El script realiza los siguientes pasos:

1. **Verificación de Balance**: Confirma que el owner tenga al menos 0.1 SOL
2. **Creación/Verificación USDC**: Crea nuevo mint o usa existente
3. **Generación de PDA**: Crea PDA único para game state
4. **Inicialización**: Ejecuta la función initialize del contrato
5. **Verificación**: Confirma que el estado se creó correctamente
6. **Output**: Muestra variables para el frontend

## 🔑 Obtener Clave Privada

Para obtener tu clave privada en formato base58:

```bash
# Si tienes un archivo keypair.json
solana-keygen pubkey ~/.config/solana/id.json --outfile /tmp/pubkey.txt
cat ~/.config/solana/id.json | jq -r 'map(tostring) | join("")' | base58

# O usar Phantom/Solflare y exportar la clave
```

## 💰 Fondear Wallet

```bash
# Obtener SOL en devnet
solana airdrop 1 <tu_wallet_address> --url devnet

# Verificar balance
solana balance <tu_wallet_address> --url devnet
```

## 📤 Output del Script

Al completarse exitosamente, el script mostrará:

```
✅ Initialize exitoso!
📄 Transaction: <transaction_id>

🎯 Estado del juego creado:
   - Owner: <owner_pubkey>
   - USDC Mint: <usdc_mint>
   - Update Authority: <update_authority>
   - Equipos creados: 0
   - Paused: false

📋 Variables para el frontend (.env.local):
NEXT_PUBLIC_SPORTS_PROGRAM_ID=<program_id>
NEXT_PUBLIC_USDC_MINT=<usdc_mint>
NEXT_PUBLIC_GAME_STATE=<game_state_pda>
```

## 🔧 Troubleshooting

### Error: Balance insuficiente
```bash
solana airdrop 1 <wallet> --url devnet
```

### Error: OWNER_PRIVATE_KEY inválida
- Verificar formato base58
- Usar `solana-keygen` para generar nueva clave

### Error: Program not found
```bash
anchor build
anchor deploy --provider.cluster devnet
```

### Error: USDC mint inválido
- Verificar que la dirección sea válida en devnet
- Dejar vacío para crear nuevo mint

## 📝 Ejemplo Completo

```bash
# 1. Configurar entorno
cd /Users/emanuel/dev/funraise/sports
cp .env.example .env

# 2. Editar .env con tu clave privada
echo "OWNER_PRIVATE_KEY=tu_clave_base58_aqui" > .env
echo "SOLANA_RPC_URL=https://api.devnet.solana.com" >> .env

# 3. Fondear wallet
solana airdrop 1 <tu_wallet> --url devnet

# 4. Ejecutar inicialización
npx ts-node scripts/initialize.ts

# 5. Copiar variables al frontend
# Usar el output del script en /ui/apps/web/.env.local
```
