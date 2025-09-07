# Plan de Arquitectura Modular - Sports Ecosystem

## 🏗️ Estructura de Contratos Propuesta

```
sports-ecosystem/
│
├── programs/
│   ├── sports-core/          # Contrato principal del juego
│   ├── sports-shop/          # Venta de teams (tienda oficial)
│   ├── sports-staking/       # Staking de teams
│   ├── sports-rewards/       # Sistema de recompensas
│   └── sports-reports/       # Reportes y analytics
│
├── external/
│   └── xfr-staking/         # Contrato de staking XFR
│
└── shared/
    └── types/               # Tipos compartidos entre contratos
```

## 📦 1. Sports Core (Contrato Base)
**Tamaño estimado**: ~80KB

### Responsabilidades:
- Gestión de GameState básico
- Registro de jugadores (Players)
- Creación de teams
- Configuración del juego

### Estructuras principales:
```rust
// Estado mínimo del juego
pub struct GameState {
    pub owner: Pubkey,
    pub game_id: u64,
    pub max_players: u16,
    pub shop_program: Pubkey,      // Programa de la tienda
    pub staking_program: Pubkey,
    pub reports_program: Pubkey,
    pub is_active: bool,
}

// Jugadores sin lógica de trading
pub struct Player {
    pub id: u16,
    pub provider_id: u16,
    pub category: PlayerCategory,
    pub metadata_uri: String,
    pub token_cost_usdc: u64,  // Solo para referencia
}
```

### Instrucciones:
- `initialize_game`
- `create_player`
- `update_player`
- `set_program_addresses` (para conectar otros contratos)

## 📦 2. Sports Shop (Tienda Oficial)
**Tamaño estimado**: ~100KB

### Responsabilidades:
- Venta de teams nuevos (mint)
- Gestión de inventarios de usuarios
- Lógica de precios y paquetes
- Integración con tokens USDC

### Estructuras:
```rust
pub struct ShopState {
    pub game_state: Pubkey,
    pub mint_fee_percentage: u8,
    pub total_teams_sold: u64,
    pub total_revenue: u64,
    pub is_sale_active: bool,
}

pub struct TeamPackage {
    pub package_type: PackageType,  // Bronze, Silver, Gold, etc.
    pub price_usdc: u64,
    pub available_quantity: u32,
}

pub struct UserInventory {
    pub user: Pubkey,
    pub owned_teams: Vec<u64>,
    pub total_spent: u64,
    pub last_purchase: i64,
}
```

### Instrucciones:
- `buy_team` (mint nuevo team)
- `buy_team_with_pack` (con paquete especial)
- `update_package_price`
- `toggle_sale_status`

### Eventos:
```rust
#[event]
pub struct TeamPurchased {
    pub buyer: Pubkey,
    pub team_id: u64,
    pub price: u64,
    pub players: [u16; 5],
    pub package_type: PackageType,
    pub timestamp: i64,
}
```

### Nota sobre futuro Marketplace:
```rust
// FUTURO: sports-marketplace (separado)
// Para mercado secundario P2P de NFTs
// - list_team_for_sale
// - buy_from_user
// - cancel_listing
// - etc.
```

## 📦 3. Sports Staking
**Tamaño estimado**: ~60KB

### Responsabilidades:
- Staking/unstaking de teams
- Gestión de estados (Warming, OnField, etc.)
- Cálculo de recompensas
- Transiciones de estado

### Estructuras:
```rust
pub struct StakingPool {
    pub game_state: Pubkey,
    pub total_staked: u32,
    pub reward_rate: u64,
}

pub struct StakedTeam {
    pub team_id: u64,
    pub owner: Pubkey,
    pub state: TeamState,
    pub staked_at: i64,
    pub transition_timestamp: i64,
    pub rewards_earned: u64,
}
```

### Instrucciones:
- `stake_team`
- `withdraw_team`
- `claim_rewards`
- `refresh_team_status`

## 📦 4. Sports Rewards
**Tamaño estimado**: ~50KB

### Responsabilidades:
- Distribución de recompensas a jugadores
- Gestión de reward pools
- Integración con staking

### Estructuras:
```rust
pub struct RewardPool {
    pub total_rewards: u64,
    pub distributed_rewards: u64,
    pub reward_token: Pubkey,
}

pub struct PlayerRewards {
    pub player: Pubkey,
    pub pending_rewards: u64,
    pub claimed_rewards: u64,
    pub last_claim: i64,
}
```

## 📦 5. Sports Reports
**Tamaño estimado**: ~70KB

### Responsabilidades:
- Generación de reportes financieros
- Tracking de ventas agregadas
- Distribución a stakers
- Pagos a proveedores

### Estructuras:
```rust
pub struct ReportsState {
    pub game_state: Pubkey,
    pub xfr_staking_program: Pubkey,
    pub current_period_revenue: u64,
    pub current_period_costs: u64,
    pub last_report_id: u64,
}

pub struct PlatformReport {
    pub report_id: u64,
    pub period_start: i64,
    pub period_end: i64,
    pub total_revenue: u64,
    pub provider_costs: u64,
    pub staker_rewards: u64,
    pub platform_profit: u64,
}
```

## 🔄 Comunicación Entre Contratos

### 1. Cross-Program Invocations (CPI)
```rust
// En Shop al vender un team
pub fn buy_team(ctx: Context<BuyTeam>) -> Result<()> {
    // ... lógica de venta ...
    
    // CPI a Sports Core para verificar jugadores
    let cpi_accounts = VerifyPlayers {
        game_state: ctx.accounts.game_state,
        players: ctx.accounts.players,
    };
    let cpi_program = ctx.accounts.sports_core_program;
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    sports_core::cpi::verify_players(cpi_ctx, player_ids)?;
    
    // Emitir evento para Reports
    emit!(TeamPurchased { ... });
    
    Ok(())
}
```

### 2. Program Derived Addresses (PDAs)
```rust
// PDA compartida entre contratos
let (shop_authority, bump) = Pubkey::find_program_address(
    &[b"shop", game_state.key().as_ref()],
    &shop_program_id,
);
```

### 3. Eventos para Sincronización
```rust
// Reports Contract escucha eventos de Shop
pub fn process_purchase_event(
    ctx: Context<ProcessEvent>,
    event_data: TeamPurchased,
) -> Result<()> {
    // Actualizar estadísticas
    ctx.accounts.reports_state.current_period_revenue += event_data.price;
    // ... más lógica ...
}
```

## 🚀 Flujo de Implementación

### Fase 1: Separación del Core (2 semanas)
1. Extraer lógica básica del juego
2. Crear Sports Core con funcionalidades mínimas
3. Migrar Players y GameState

### Fase 2: Shop (Tienda) (2 semanas)
1. Mover lógica de buy_team
2. Implementar sistema de inventarios
3. Integrar con Sports Core via CPI

### Fase 3: Staking Independiente (1 semana)
1. Extraer lógica de staking
2. Crear contratos de staking
3. Conectar con Shop para verificar ownership

### Fase 4: Reports System (2 semanas)
1. Implementar tracking de eventos
2. Crear sistema de reportes
3. Integrar con XFR Staking

### Fase 5: Testing & Migración (1 semana)
1. Tests de integración
2. Migración de datos
3. Deployment coordinado

## 💾 Ejemplo de Migración

```typescript
// Script de migración
async function migrateToModular() {
    // 1. Deploy nuevos contratos
    const sportsCore = await deployProgram('sports-core');
    const sportsShop = await deployProgram('sports-shop');
    
    // 2. Inicializar con datos existentes
    await sportsCore.initialize({
        owner: currentOwner,
        existingPlayers: await getExistingPlayers(),
    });
    
    // 3. Conectar contratos entre sí
    await sportsCore.setProgramAddresses({
        shop: sportsShop.programId,
        staking: staking.programId,
        reports: reports.programId,
    });
    
    // 4. Migrar usuarios gradualmente
    await migrateUserData();
}
```

## 📊 Beneficios de esta Arquitectura

### Costos de Deployment:
- **Monolítico**: 429KB = ~0.6 SOL
- **Modular**: 5 x ~80KB = ~0.15 SOL total

### Costos de Actualización:
- **Monolítico**: Re-deploy todo = ~0.6 SOL
- **Modular**: Solo el módulo = ~0.03 SOL

### Ventajas Técnicas:
1. **Desarrollo paralelo**: Equipos pueden trabajar en diferentes módulos
2. **Testing aislado**: Cada módulo se prueba independientemente
3. **Actualizaciones sin downtime**: Actualizar Shop sin afectar Staking
4. **Menor riesgo**: Un bug en Reports no afecta el juego principal

## 🔧 Herramientas Necesarias

1. **Anchor Workspace**: Para manejar múltiples programas
```toml
[workspace]
members = [
    "programs/sports-core",
    "programs/sports-shop",
    "programs/sports-staking",
    "programs/sports-rewards",
    "programs/sports-reports"
]
```

2. **Shared Types Library**:
```rust
// shared/src/lib.rs
pub mod events;
pub mod errors;
pub mod constants;
```

3. **Integration Tests**:
```typescript
describe("Sports Ecosystem Integration", () => {
    it("should handle cross-program team purchase", async () => {
        // Test completo del flujo
    });
});
```

## ✅ Checklist de Migración

- [ ] Definir interfaces exactas entre contratos
- [ ] Crear tipos compartidos
- [ ] Implementar Sports Core
- [ ] Implementar Shop con CPI a Core
- [ ] Migrar lógica de staking
- [ ] Crear sistema de reportes
- [ ] Tests de integración completos
- [ ] Plan de migración de datos
- [ ] Documentación de APIs
- [ ] Auditoría de seguridad

¿Listo para comenzar con esta arquitectura modular? 