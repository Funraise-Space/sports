# Estrategia de Implementación: Sistema de Reportes y Pagos

## 🏗️ Arquitectura Modular Recomendada

### ⚠️ Problema: Límite de 10KB en Contratos Solana

El contrato Sports ya maneja mucha lógica. Agregar todo el sistema de reportes lo haría demasiado grande.

#### 📏 ¿Qué significa el límite de 10KB?

**CORRECCIÓN: El límite de 10KB es para despliegue en UNA SOLA transacción**

**Para programas más grandes (como el tuyo de 429KB):**
- Se usa **Buffer Deployment** (múltiples transacciones)
- Primero se crea un buffer account
- Se sube el programa en chunks
- Finalmente se despliega desde el buffer

**Ejemplo real del contrato Sports actual:**
```bash
# Tu contrato actual
sports.so: 429KB

# Despliegue con buffer:
1. Crear buffer: ~0.5 SOL para rent
2. Subir en ~100+ transacciones 
3. Deploy final desde buffer
4. Total: ~0.6-0.7 SOL en fees

# vs programa pequeño (<10KB):
- 1 transacción: ~0.002 SOL
```

**¿Por qué separar contratos entonces?**
- **Costos de actualización**: Cada update requiere re-subir todo
- **Modularidad**: Actualizar solo la parte que cambió
- **Claridad**: Separación de responsabilidades
- **Seguridad**: Menor superficie de ataque
- **Mantenibilidad**: Más fácil de auditar y testear

### ✅ Solución: Separar en 3 Contratos

```
┌─────────────────────┐
│   Sports Contract   │  ← Core del juego
│  - Players/Teams    │
│  - Buy/Sell         │
│  - Team Staking     │
│  - Basic Tracking   │
└──────────┬──────────┘
           │ Read-only CPI
           ▼
┌─────────────────────┐
│  Reports Contract   │  ← Sistema financiero
│  - Generate Reports │
│  - Provider Details │
│  - Staker Claims    │
│  - Payment Tracking │
└──────────┬──────────┘
           │ CPI
           ▼
┌─────────────────────┐
│ XFR Staking Contract│  ← Staking de tokens
│  - Stake/Unstake    │
│  - User Tracking    │
│  - Snapshot Data    │
└─────────────────────┘
```

### 📦 División de Responsabilidades:

#### **1. Sports Contract (Existente + Minimal Tracking)**
```rust
// MANTENER en Sports Contract:
- Players, Teams, GameState
- buy_team, sell_team  
- stake_team, withdraw_team
- Staff management

// AGREGAR Mínimo para Tracking:
pub struct GameState {
    // ... campos existentes ...
    
    // Solo contadores simples
    pub total_revenue: u64,
    pub total_teams_sold: u64,
    pub reports_contract: Pubkey,  // Referencia al contrato de reportes
}

// En buy_team solo actualizar contador:
game_state.total_revenue += price_paid;
game_state.total_teams_sold += 1;

// Emitir evento con detalles
emit!(TokenSold { ... });
```

#### **2. Reports Contract (Nuevo)**
```rust
// TODO el sistema de reportes y pagos:
- PlatformReport
- ReportProviderDetail  
- ProviderStats
- UserRewards
- generate_platform_report()
- claim_staking_rewards()
- mark_provider_paid()
- get_provider_payment_details()

// Lee datos del Sports Contract via CPI cuando necesita
```

#### **3. XFR Staking Contract (Separado)**
```rust
// Maneja el staking de tokens XFR
- Stake/Unstake XFR
- Track de usuarios staking
- Proveer snapshots para reportes
```

### 🎯 Ventajas de esta Arquitectura:

1. **Tamaño**: Cada contrato se mantiene bajo 10KB
2. **Separación**: Lógica de juego vs lógica financiera
3. **Mantenibilidad**: Más fácil actualizar cada parte
4. **Seguridad**: Menor superficie de ataque
5. **Reutilización**: Reports puede servir para otros productos

### 🔄 Flujo de Interacción:

```rust
// 1. Usuario compra team en Sports Contract
buy_team() {
    // Lógica del juego
    // Emitir evento TokenSold
    // Actualizar contador básico
}

// 2. Owner genera reporte en Reports Contract  
generate_report() {
    // CPI para leer total_revenue de Sports
    let sports_data = sports_contract.get_game_state();
    
    // Leer eventos TokenSold del período
    let sales = get_events_from_logs();
    
    // Generar reporte con los datos
}

// 3. Staker reclama en Reports Contract
claim_rewards() {
    // CPI a XFR Staking para verificar eligibilidad
    let was_staking = xfr_staking.was_user_staking_at(user, timestamp);
    
    // Pagar si es elegible
}
```

### 💾 Datos Mínimos en Sports Contract:

Solo agregar lo esencial para no perder la conexión:
```rust
// En GameState agregar:
pub reports_contract: Option<Pubkey>,
pub total_historical_revenue: u64,
pub total_historical_teams: u64,

// En Player mantener:
pub token_cost_usdc: u64,  // Necesario para los cálculos
```

### 🚀 Plan de Implementación:

1. **Fase 1**: Agregar tracking mínimo a Sports Contract
2. **Fase 2**: Desarrollar Reports Contract separado
3. **Fase 3**: Integrar con XFR Staking Contract
4. **Fase 4**: Testing de integración completa

¿Prefieres esta arquitectura modular o mantenemos todo en un solo contrato?

## 🎯 Objetivo
Implementar un sistema completo de tracking de ganancias, reportes y distribución de pagos a proveedores, stakers y otros contratos.

## 🏗️ Decisión Arquitectónica: **CONTRATOS SEPARADOS** ✅

Mantendremos el staking de XFR en un **contrato independiente** por las siguientes razones:

1. **Separación de responsabilidades**: Sports Contract se enfoca en jugadores/equipos
2. **Escalabilidad**: El contrato de staking puede evolucionar sin afectar Sports
3. **Seguridad**: Menor superficie de ataque, auditorías más simples
4. **Reutilización**: El staking de XFR servirá para múltiples productos
5. **Límites técnicos**: Evitamos el límite de 10KB de Solana

### Arquitectura de Contratos:
```
┌─────────────────┐     CPI      ┌──────────────────┐
│ Sports Contract │──────────────►│ XFR Staking      │
│                 │               │ Contract         │
└─────────────────┘               └──────────────────┘
        │                                  │
        │                                  │
        ▼                                  ▼
   ┌─────────┐                      ┌─────────┐
   │  USDC   │                      │   XFR   │
   └─────────┘                      └─────────┘
```

## 📊 Estructura de Datos Actualizada

### 1. **Player - Agregar costo por token**
```rust
#[account]
pub struct Player {
    // ... campos existentes ...
    pub token_cost_usdc: u64,  // Costo USDC por token de ESTE jugador
}
```

### 2. **ProviderStats - Tracking detallado**
```rust
#[account]
pub struct ProviderStats {
    pub provider_id: u16,
    pub total_tokens_sold: u64,      
    pub total_revenue_usdc: u64,     
    pub pending_payment: u64,         // Suma acumulada de costos por tokens vendidos
    pub total_paid: u64,             
    pub last_payment_timestamp: i64,  
}
```

### 3. **TokenSale - EVENTO, NO CUENTA** ⚠️
```rust
// ❌ NO hacemos esto (sería muy costoso):
// #[account]
// pub struct TokenSale { ... }

// ✅ Solo definimos la estructura para el EVENTO:
#[event]
pub struct TokenSold {  // Cambié el nombre para ser más claro que es un evento
    pub sale_id: u64,                 // ID único de la venta
    pub player_id: u16,               // Qué jugador
    pub provider_id: u16,             // Qué proveedor
    pub team_id: u64,                 // En qué equipo se vendió
    pub token_cost: u64,              // Costo del token en el momento de venta
    pub timestamp: i64,               // Cuándo se vendió
    pub buyer: Pubkey,                // Quién compró el team
    pub team_price: u64,              // Precio total del team
    pub report_id: u64,               // A qué reporte pertenecerá
}

// NO se crea ninguna cuenta, solo se emite el evento
```

### 📊 Comparación de Costos:

| Modelo | Cuentas por Team (5 jugadores) | Costo Aproximado |
|--------|--------------------------------|------------------|
| Full On-chain | 5 cuentas TokenSale | ~0.05 SOL |
| Híbrido (Eventos) | 0 cuentas nuevas | ~0.0001 SOL |
| Solo Agregados | 0 cuentas nuevas | ~0.0001 SOL |

**Ahorro: 99.8% menos costoso** 🎉

### 4. **GameState - Agregar tracking de ventas**
```rust
pub struct GameState {
    // ... campos existentes ...
    
    pub next_sale_id: u64,            // Para generar IDs únicos de venta
    
    // Tracking financiero
    pub total_revenue: u64,
    pub total_provider_costs: u64,    
    pub total_platform_profit: u64,
    pub total_staker_distributions: u64,
}
```

### 5. **ReportProviderDetail - Mejorado con detalle de ventas**
```rust
#[account]
pub struct ReportProviderDetail {
    pub report_id: u64,
    pub provider_id: u16,
    pub tokens_sold_period: u32,      
    pub revenue_generated: u64,       
    pub payment_amount: u64,          
    pub paid: bool,
    pub payment_timestamp: i64,
    pub sale_ids: Vec<u64>,           // NUEVO: IDs de las ventas incluidas
}
```

## 🔄 Flujo de Operaciones Actualizado

### 1. **Tracking Detallado en buy_team**
```rust
// En buy_team, después de la compra exitosa:
1. GameState.total_revenue += price_paid_usdc

2. Para cada jugador en el equipo:
   - Obtener player_data
   - Crear TokenSale:
     * sale_id = next_sale_id++
     * player_id = player.id
     * provider_id = player.provider_id
     * team_id = current_team_id
     * token_cost = player.token_cost_usdc
     * timestamp = clock.timestamp
     * buyer = user
     * team_price = price_paid_usdc
   
   - Actualizar ProviderStats:
     * tokens_sold += 1
     * pending_payment += player.token_cost_usdc
   
   - GameState.total_provider_costs += player.token_cost_usdc
```

### 2. **Consulta de Ventas por Período**
```rust
get_sales_in_period(period_start, period_end) -> Vec<TokenSale> {
    // Filtrar todas las TokenSale donde:
    // timestamp >= period_start && timestamp <= period_end
}

get_sales_by_provider(provider_id, period_start, period_end) -> Vec<TokenSale> {
    // Filtrar TokenSale por provider_id y período
}
```

### 3. **Generación de Reportes con Detalle**
```rust
generate_platform_report(period_start, period_end) {
    // 1. Obtener todas las ventas del período
    sales = get_sales_in_period(period_start, period_end)
    
    // 2. Agrupar por proveedor
    sales_by_provider = group_by_provider(sales)
    
    // 3. Para cada proveedor:
    for (provider_id, provider_sales) in sales_by_provider {
        // Crear ReportProviderDetail
        detail = ReportProviderDetail {
            provider_id,
            tokens_sold_period: provider_sales.len(),
            payment_amount: sum(sale.token_cost for sale in provider_sales),
            sale_ids: provider_sales.map(|s| s.sale_id),
            // ... otros campos
        }
    }
    
    // 4. Calcular totales y crear PlatformReport
}
```

## 📈 Ventajas del Tracking Individual

1. **Auditoría Completa**: Sabemos exactamente qué se vendió, cuándo y a quién
2. **Reportes Detallados**: Podemos generar reportes por jugador, proveedor, período, etc.
3. **Verificación**: Proveedores pueden verificar sus ventas token por token
4. **Analytics**: Datos ricos para análisis (jugadores más vendidos, tendencias, etc.)
5. **Dispute Resolution**: Si hay disputas, tenemos el registro completo

## 🔍 Queries Útiles

```rust
// 1. Ventas de un jugador específico
get_player_sales(player_id: u16) -> Vec<TokenSale>

// 2. Historial de compras de un usuario
get_user_purchases(buyer: Pubkey) -> Vec<TokenSale>

// 3. Jugadores más vendidos en un período
get_top_players(period_start, period_end, limit: u8) -> Vec<(u16, u32)>

// 4. Revenue por categoría
get_revenue_by_category(period_start, period_end) -> CategoryRevenue

// 5. Detalle de ventas para un reporte
get_report_sales_detail(report_id: u64) -> Vec<TokenSale>
```

## 💾 Modelo Híbrido Optimizado para Reportes

### Estrategia de Almacenamiento:

#### 1. **On-chain: Agregados por Período**
```rust
// Tracking acumulativo en GameState
pub struct GameState {
    // ... campos existentes ...
    
    // Totales históricos
    pub total_revenue: u64,
    pub total_provider_costs: u64,
    pub total_teams_sold: u64,
    pub total_tokens_sold: u64,
    
    // Para el período actual (se resetea al generar reporte)
    pub current_period_revenue: u64,
    pub current_period_costs: u64,
    pub current_period_teams: u32,
    pub current_period_start: i64,
}

// Tracking por proveedor
pub struct ProviderStats {
    pub provider_id: u16,
    
    // Totales históricos
    pub total_tokens_sold: u64,
    pub total_earned: u64,
    pub total_withdrawn: u64,
    
    // Período actual
    pub current_period_tokens: u32,
    pub current_period_earnings: u64,
    
    // Balance
    pub pending_payment: u64,
}
```

#### 2. **Eventos: Detalle de Ventas**
```rust
#[event]
pub struct TokenSold {
    pub sale_id: u64,
    pub player_id: u16,
    pub provider_id: u16,
    pub team_id: u64,
    pub token_cost: u64,
    pub timestamp: i64,
    pub buyer: Pubkey,
    pub team_package: TeamPackage,
}
```

#### 3. **Flujo Optimizado**

```rust
// En buy_team:
1. Para cada jugador vendido:
   - Emitir evento TokenSold (detalle)
   - Actualizar ProviderStats:
     * current_period_tokens += 1
     * current_period_earnings += token_cost
     * pending_payment += token_cost
   - Actualizar GameState:
     * current_period_revenue += (price / 5)
     * current_period_costs += token_cost

2. Al final:
   - GameState.current_period_teams += 1
   - GameState.total_revenue += price_paid
```

### Ventajas de este Modelo:

1. **Eficiencia en Reportes**: No necesitas iterar ventas individuales
2. **Agregados Listos**: Los totales ya están calculados
3. **Detalle Disponible**: Via eventos para queries específicas
4. **Gas Eficiente**: Solo actualizas agregados, no creas cuentas nuevas
5. **Auditable**: Los eventos proveen el rastro completo

### Ejemplo de Generación de Reporte:

```rust
pub fn generate_platform_report(ctx: Context<GenerateReport>) -> Result<()> {
    let game_state = &ctx.accounts.game_state;
    let clock = &ctx.accounts.clock;
    
    // 1. Usar agregados pre-calculados
    let period_revenue = game_state.current_period_revenue;
    let period_costs = game_state.current_period_costs;
    let gross_profit = period_revenue.saturating_sub(period_costs);
    
    // 2. Calcular distribución
    let staker_pool = gross_profit * 3000 / 10000;
    let platform_net = gross_profit * 7000 / 10000;
    
    // 3. Crear reporte
    let report = &mut ctx.accounts.platform_report;
    report.period_revenue = period_revenue;
    report.provider_payments_total = period_costs;
    report.staker_pool_amount = staker_pool;
    report.platform_net_profit = platform_net;
    report.timestamp = clock.unix_timestamp;
    
    // 4. Snapshot de stakers (CPI)
    report.stakers_count_snapshot = get_stakers_count()?;
    
    // 5. Resetear período
    game_state.current_period_revenue = 0;
    game_state.current_period_costs = 0;
    game_state.current_period_teams = 0;
    game_state.current_period_start = clock.unix_timestamp;
    
    Ok(())
}
```

## 📊 Comparación de Modelos

| Aspecto | Full On-chain | Solo Eventos | Híbrido (Recomendado) |
|---------|---------------|--------------|----------------------|
| Gas por venta | Alto (nueva cuenta) | Bajo | Medio (actualizar agregados) |
| Generar reporte | Muy costoso | Imposible on-chain | Eficiente |
| Queries detalle | Fácil | Requiere indexador | Requiere indexador |
| Verificabilidad | Total | Via eventos | Agregados + eventos |
| Escalabilidad | Pobre | Buena | Excelente |

## 🎯 ¿Por qué el Modelo Híbrido es Mejor para Reportes?

### Problema con Modelo Full On-chain:
```rust
// ❌ Ineficiente: Iterar miles de ventas
for sale in all_token_sales {
    if sale.timestamp >= period_start && sale.timestamp <= period_end {
        total_revenue += sale.price;
        provider_earnings[sale.provider_id] += sale.token_cost;
    }
}
// Gas cost: O(n) donde n = número de ventas
```

### Solución con Modelo Híbrido:
```rust
// ✅ Eficiente: Usar agregados pre-calculados
let period_revenue = game_state.current_period_revenue;
let period_costs = game_state.current_period_costs;
let profit = period_revenue - period_costs;
// Gas cost: O(1) - constante!
```

### Implementación Actualizada de buy_team:

```rust
pub fn buy_team(ctx: Context<BuyTeam>, /* params */) -> Result<()> {
    let clock = &ctx.accounts.clock;
    let game_state = &mut ctx.accounts.game_state;
    
    // ... validaciones y lógica existente ...
    
    let mut total_provider_cost = 0u64;
    let team_revenue_share = price_paid / 5; // cada jugador aporta 1/5 del precio
    
    // Procesar cada jugador del equipo
    for (idx, player_id) in players.iter().enumerate() {
        let player = get_player_account(player_id)?;
        let provider_stats = get_provider_stats_mut(player.provider_id)?;
        
        // 1. Actualizar agregados del proveedor
        provider_stats.current_period_tokens += 1;
        provider_stats.current_period_earnings += player.token_cost_usdc;
        provider_stats.pending_payment += player.token_cost_usdc;
        provider_stats.total_tokens_sold += 1;
        
        // 2. Acumular costo total
        total_provider_cost += player.token_cost_usdc;
        
        // 3. Emitir evento con detalle (para indexación)
        emit!(TokenSold {
            sale_id: game_state.next_sale_id,
            player_id: player.id,
            provider_id: player.provider_id,
            team_id: team.id,
            token_cost: player.token_cost_usdc,
            timestamp: clock.unix_timestamp,
            buyer: ctx.accounts.user.key(),
            team_package: package_type,
        });
        
        game_state.next_sale_id += 1;
    }
    
    // 4. Actualizar agregados globales del período
    game_state.current_period_revenue += price_paid;
    game_state.current_period_costs += total_provider_cost;
    game_state.current_period_teams += 1;
    
    // 5. Actualizar totales históricos
    game_state.total_revenue += price_paid;
    game_state.total_provider_costs += total_provider_cost;
    game_state.total_teams_sold += 1;
    game_state.total_tokens_sold += 5;
    
    Ok(())
}
```

### Flujo de Generación de Reporte Simplificado:

```
1. Owner llama generate_report()
   │
   ├─► Lee agregados del período actual (O(1))
   ├─► Calcula profit = revenue - costs
   ├─► Distribuye profit según porcentajes
   ├─► Crea PlatformReport con totales
   └─► Resetea contadores para siguiente período

2. Para cada proveedor:
   │
   ├─► Lee ProviderStats (ya tiene agregados)
   ├─► Crea ReportProviderDetail
   └─► Marca tokens del período para pago

3. Resultado:
   - Reporte generado eficientemente
   - Proveedores pueden reclamar pagos
   - Eventos disponibles para auditoría detallada
```

### Ventajas Clave para Reportes:

1. **Generación Instantánea**: No importa si hay 100 o 100,000 ventas
2. **Gas Predecible**: Costo fijo por reporte, no escala con ventas
3. **Datos Siempre Listos**: Los agregados se actualizan en tiempo real
4. **Auditoría Completa**: Los eventos proveen el detalle si se necesita
5. **Sin Bloqueos**: El sistema sigue funcionando mientras se genera el reporte

## 🔗 Vinculación de Eventos con Reportes

### El Problema:
¿Cómo sabe el sistema off-chain qué ventas (TokenSold) pertenecen a cada reporte?

### Solución 1: Por Timestamp (Simple pero Efectiva)
```rust
// En PlatformReport agregamos:
pub struct PlatformReport {
    pub report_id: u64,
    pub period_start: i64,      // Timestamp inicio del período
    pub period_end: i64,        // Timestamp fin del período
    // ... otros campos ...
}

// En generate_report:
let report = &mut ctx.accounts.platform_report;
report.period_start = game_state.current_period_start;
report.period_end = clock.unix_timestamp;

// Off-chain query:
// Buscar todos los TokenSold donde:
// timestamp >= report.period_start && timestamp < report.period_end
```

### Solución 2: Report ID en GameState (Más Precisa)
```rust
// En GameState agregamos:
pub struct GameState {
    // ... campos existentes ...
    pub current_report_id: u64,      // ID del reporte actual
    pub next_report_id: u64,         // Para el próximo reporte
}

// En TokenSold agregamos:
#[event]
pub struct TokenSold {
    // ... campos existentes ...
    pub report_id: u64,              // A qué reporte pertenecerá esta venta
}

// En buy_team:
emit!(TokenSold {
    // ... otros campos ...
    report_id: game_state.current_report_id,  // Vincular al reporte actual
});

// En generate_report:
// 1. Crear reporte con current_report_id
// 2. Incrementar: current_report_id = next_report_id++

// Off-chain query:
// Buscar todos los TokenSold donde report_id = X
```

### Solución 3: Híbrida con Sale IDs (Recomendada) ✅
```rust
// En PlatformReport:
pub struct PlatformReport {
    pub report_id: u64,
    pub period_start: i64,
    pub period_end: i64,
    pub first_sale_id: u64,         // Primera venta del período
    pub last_sale_id: u64,          // Última venta del período
    pub total_sales: u32,           // Cantidad de ventas
}

// En generate_report:
let report = &mut ctx.accounts.platform_report;
report.first_sale_id = game_state.report_last_sale_id + 1;
report.last_sale_id = game_state.next_sale_id - 1;
report.total_sales = (report.last_sale_id - report.first_sale_id + 1) as u32;

// Actualizar para próximo reporte
game_state.report_last_sale_id = report.last_sale_id;

// Off-chain query múltiples opciones:
// 1. Por sale_id: sale_id >= first_sale_id && sale_id <= last_sale_id
// 2. Por timestamp como validación adicional
// 3. Verificar que total_sales coincida
```

### Implementación Completa con Vinculación:

```rust
// GameState mejorado
pub struct GameState {
    // ... campos existentes ...
    
    // IDs de ventas
    pub next_sale_id: u64,
    pub report_last_sale_id: u64,    // Última venta del reporte anterior
    
    // Tracking de reportes
    pub current_report_id: u64,
    pub current_period_start: i64,
}

// Flujo completo:
pub fn buy_team(ctx: Context<BuyTeam>) -> Result<()> {
    // ... lógica existente ...
    
    emit!(TokenSold {
        sale_id: game_state.next_sale_id,
        report_id: game_state.current_report_id,  // Vincular a reporte futuro
        timestamp: clock.unix_timestamp,
        // ... otros datos ...
    });
    
    game_state.next_sale_id += 1;
}

pub fn generate_platform_report(ctx: Context<GenerateReport>) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    let report = &mut ctx.accounts.platform_report;
    
    // Definir rango de ventas de este reporte
    report.report_id = game_state.current_report_id;
    report.period_start = game_state.current_period_start;
    report.period_end = clock.unix_timestamp;
    report.first_sale_id = game_state.report_last_sale_id + 1;
    report.last_sale_id = game_state.next_sale_id - 1;
    
    // ... generar reporte con agregados ...
    
    // Preparar para siguiente período
    game_state.current_report_id += 1;
    game_state.current_period_start = clock.unix_timestamp;
    game_state.report_last_sale_id = report.last_sale_id;
    
    // Emitir evento del reporte
    emit!(ReportGenerated {
        report_id: report.report_id,
        first_sale_id: report.first_sale_id,
        last_sale_id: report.last_sale_id,
        total_sales: report.total_sales,
        period_start: report.period_start,
        period_end: report.period_end,
    });
}
```

### Queries Off-chain Facilitadas:

```typescript
// 1. Obtener ventas de un reporte específico
async function getReportSales(reportId: number) {
    // Primero obtener el reporte on-chain
    const report = await program.account.platformReport.fetch(reportPDA);
    
    // Luego buscar eventos
    const sales = await connection.getProgramAccounts(programId, {
        filters: [
            { dataSize: TokenSoldEvent.size },
            { memcmp: { offset: 8, bytes: bs58.encode(reportId) } }
        ]
    });
    
    // O por rango de sale_ids
    return sales.filter(s => 
        s.sale_id >= report.first_sale_id && 
        s.sale_id <= report.last_sale_id
    );
}

// 2. Verificar integridad
async function verifyReportIntegrity(reportId: number) {
    const report = await getReport(reportId);
    const sales = await getReportSales(reportId);
    
    // Verificar cantidad
    assert(sales.length === report.total_sales);
    
    // Verificar totales
    const calculatedRevenue = sales.reduce((sum, s) => sum + s.team_price, 0);
    const calculatedCosts = sales.reduce((sum, s) => sum + s.token_cost, 0);
    
    // Deberían coincidir con los agregados on-chain
    assert(calculatedRevenue === report.period_revenue);
    assert(calculatedCosts === report.provider_payments_total);
}

// 3. Detalle por proveedor
async function getProviderSalesInReport(providerId: number, reportId: number) {
    const allSales = await getReportSales(reportId);
    return allSales.filter(s => s.provider_id === providerId);
}
```

### Ventajas de la Vinculación:

1. **Precisión Total**: Sabes exactamente qué ventas pertenecen a cada reporte
2. **Verificabilidad**: Puedes reconstruir los totales desde los eventos
3. **Auditoría Simple**: "Muéstrame todas las ventas del reporte #5"
4. **Sin Ambigüedad**: No hay dudas sobre ventas en el límite de períodos
5. **Queries Eficientes**: Puedes filtrar por report_id o por rango de sale_id

## 💰 Cálculos Detallados para Generación de Reportes

### 📊 Estructura de Cálculo:

```rust
pub fn generate_platform_report(ctx: Context<GenerateReport>) -> Result<()> {
    let game_state = &mut ctx.accounts.game_state;
    
    // 1. REVENUE DEL PERÍODO
    let period_revenue = game_state.current_period_revenue;
    // Ejemplo: 100 teams vendidos × $50 = $5,000
    
    // 2. COSTOS DE PROVEEDORES DEL PERÍODO
    let period_provider_costs = game_state.current_period_costs;
    // Ejemplo: 500 tokens × costos variables = $1,500
    
    // 3. GANANCIA BRUTA DEL PERÍODO
    let gross_profit = period_revenue.saturating_sub(period_provider_costs);
    // $5,000 - $1,500 = $3,500
    
    // 4. DISTRIBUCIÓN DE GANANCIA (SIN DAO)
    // Stakers: 30% de la ganancia
    let staker_pool = gross_profit * 3000 / 10000; // 30%
    // $3,500 × 30% = $1,050
    
    // Plataforma: 70% de la ganancia
    let platform_net = gross_profit * 7000 / 10000; // 70%
    // $3,500 × 70% = $2,450
    
    // 5. SNAPSHOT DE STAKERS
    let stakers_count = get_stakers_count_from_xfr_contract()?;
    // Ejemplo: 50 stakers activos
    
    // 6. CÁLCULO POR STAKER
    let reward_per_staker = if stakers_count > 0 {
        staker_pool / stakers_count as u64
    } else {
        0
    };
    // $1,050 / 50 = $21 por staker
    
    // 7. ACTUALIZAR TOTALES HISTÓRICOS
    game_state.total_revenue += period_revenue;
    game_state.total_provider_costs += period_provider_costs;
    game_state.total_platform_profit += platform_net;
    game_state.total_staker_distributions += staker_pool;
}
```

### 🧮 Ejemplo Completo con Números Reales:

#### Escenario: 1 Semana de Operaciones

**Ventas del Período:**
- 100 teams vendidos
- Precio promedio: $50 por team
- Total de tokens vendidos: 500 (5 por team)

**Desglose de Tokens Vendidos:**
```
Bronze Players (200 tokens):
- Jugador A: 80 tokens × $0.50 = $40
- Jugador B: 120 tokens × $0.60 = $72
Subtotal Bronze: $112

Silver Players (200 tokens):
- Jugador C: 100 tokens × $1.20 = $120
- Jugador D: 100 tokens × $1.50 = $150
Subtotal Silver: $270

Gold Players (100 tokens):
- Jugador E: 60 tokens × $2.00 = $120
- Jugador F: 40 tokens × $2.50 = $100
Subtotal Gold: $220

Legendary Players (0 tokens este período)

TOTAL COSTOS PROVEEDORES: $602
```

**Cálculos del Reporte:**
```
1. Revenue Total: 100 teams × $50 = $5,000

2. Costos Proveedores: $602 (suma de arriba)

3. Ganancia Bruta: $5,000 - $602 = $4,398

4. Distribución de Ganancia ($4,398):
   - Stakers (30%): $1,319.40
   - Platform (70%): $3,078.60

5. Si hay 50 stakers:
   - Por staker: $1,319.40 / 50 = $26.39

6. Totales Acumulados (si es el 3er reporte):
   - Total Revenue Histórico: $15,000
   - Total Costos Históricos: $2,100
   - Total Ganancia Distribuida: $12,900
```

### 📈 Tracking de Proveedores Individual:

```rust
// Para cada proveedor en el reporte:
pub struct ReportProviderDetail {
    pub provider_id: u16,
    pub tokens_sold_period: u32,      // Ej: 80 tokens
    pub revenue_generated: u64,       // Ej: 80 × $50/5 = $800
    pub payment_amount: u64,          // Ej: 80 × $0.50 = $40
    pub profit_contribution: u64,     // Ej: $800 - $40 = $760
}
```

### 🔍 Verificación y Auditoría:

```typescript
// Off-chain: Verificar cálculos del reporte
async function auditReport(reportId: number) {
    const report = await getReport(reportId);
    const sales = await getReportSales(reportId);
    
    // 1. Verificar revenue
    const calculatedRevenue = sales.reduce((sum, sale) => 
        sum + sale.team_price, 0
    );
    assert(calculatedRevenue === report.period_revenue);
    
    // 2. Verificar costos por proveedor
    const costsByProvider = {};
    sales.forEach(sale => {
        costsByProvider[sale.provider_id] = 
            (costsByProvider[sale.provider_id] || 0) + sale.token_cost;
    });
    
    // 3. Verificar distribución
    const profit = report.period_revenue - report.provider_payments_total;
    assert(report.staker_pool_amount === Math.floor(profit * 0.3));
    assert(report.platform_net_profit === Math.floor(profit * 0.7));
}
```

### 💡 Puntos Clave del Cálculo:

1. **Revenue**: Suma de todos los precios de teams vendidos
2. **Costos**: Suma de (tokens vendidos × costo individual del token)
3. **Ganancia**: Revenue - Costos
4. **Distribución**: Se reparte la GANANCIA, no el revenue
5. **Stakers**: Reciben partes iguales, no proporcional a su stake
6. **Acumulados**: Se mantienen totales históricos para análisis

### 🎯 Resumen Visual:

```
REVENUE ($5,000)
    │
    ├─► Costos Proveedores ($602) ──► A cada proveedor según sus tokens
    │
    └─► GANANCIA ($4,398)
            │
            ├─► 30% Stakers ($1,319) ──► Dividido igual entre todos
            └─► 70% Platform ($3,079)
```

## 🔐 Seguridad de Pagos y Flexibilidad de Períodos

### 1. **Prevención de Doble Pago**

```rust
// En ProviderStats
pub struct ProviderStats {
    // Tracking separado para evitar doble pago
    pub pending_payment: u64,        // Lo que se debe pagar
    pub total_withdrawn: u64,        // Lo que ya se pagó
    
    // Para el período actual
    pub current_period_tokens: u32,
    pub current_period_earnings: u64,
}

// Al generar reporte
pub fn generate_platform_report() {
    // Los montos del período se "congelan" en el reporte
    let report_detail = ReportProviderDetail {
        provider_id: provider.id,
        tokens_sold_period: provider.current_period_tokens,
        payment_amount: provider.current_period_earnings,
        paid: false,  // Marca de pago pendiente
        // Detalle de jugadores vendidos disponible via eventos
    };
    
    // Reset para siguiente período
    provider.current_period_tokens = 0;
    provider.current_period_earnings = 0;
}

// PROVEEDORES NO RETIRAN - Owner consulta y paga manualmente
pub fn get_provider_payment_details(provider_id: u16, report_id: u64) -> ProviderPaymentInfo {
    let detail = get_report_provider_detail(provider_id, report_id);
    
    // Obtener eventos del período para el detalle
    let sales = get_provider_sales_in_report(provider_id, report_id);
    
    return ProviderPaymentInfo {
        provider_id,
        report_id,
        total_tokens_sold: detail.tokens_sold_period,
        total_payment: detail.payment_amount,
        already_paid: detail.paid,
        sales_breakdown: sales.map(|s| SaleDetail {
            player_id: s.player_id,
            player_name: get_player_name(s.player_id),
            token_cost: s.token_cost,
            team_id: s.team_id,
            buyer: s.buyer,
            timestamp: s.timestamp,
        })
    };
}

// Owner marca como pagado después de transferir off-chain
pub fn mark_provider_paid(provider_id: u16, report_id: u64) {
    require!(ctx.accounts.user.key() == game_state.owner);
    
    let detail = get_report_provider_detail_mut(provider_id, report_id);
    require!(!detail.paid, "Ya marcado como pagado");
    
    detail.paid = true;
    detail.payment_timestamp = clock.unix_timestamp;
    
    let provider_stats = get_provider_stats_mut(provider_id);
    provider_stats.pending_payment -= detail.payment_amount;
    provider_stats.total_withdrawn += detail.payment_amount;
}
```

### 2. **Tracking de Stakers con Claims Acumulables**

```rust
// En PlatformReport - sin cambios
pub struct PlatformReport {
    pub report_id: u64,
    pub staker_pool_amount: u64,     
    pub stakers_count_snapshot: u32,  
    pub reward_per_staker: u64,       
    pub stakers_claimed: u32,         
}

// En UserRewards - tracking más flexible
pub struct UserRewards {
    pub user: Pubkey,
    pub claimed_reports: Vec<u64>,    // Lista de reportes ya reclamados
    pub total_claimed: u64,
}

// STAKERS PUEDEN RECLAMAR MÚLTIPLES REPORTES ACUMULADOS
pub fn claim_staking_rewards(report_ids: Vec<u64>) {
    let user_rewards = get_or_create_user_rewards(ctx.accounts.user);
    let xfr_staking_contract = &ctx.accounts.xfr_staking_contract;
    
    let mut total_to_claim = 0u64;
    let mut reports_to_mark = Vec::new();
    
    for report_id in report_ids {
        // Verificar que no se haya reclamado antes
        require!(
            !user_rewards.claimed_reports.contains(&report_id),
            "Reporte {} ya fue reclamado", report_id
        );
        
        let report = get_platform_report(report_id);
        
        // Verificar elegibilidad via CPI al contrato XFR
        let was_staking = xfr_staking_contract.was_user_staking_at(
            ctx.accounts.user.key(),
            report.timestamp
        )?;
        
        require!(was_staking, "No estabas staking en reporte {}", report_id);
        
        // Acumular reward
        total_to_claim += report.reward_per_staker;
        reports_to_mark.push(report_id);
        
        // Actualizar contador en el reporte
        report.stakers_claimed += 1;
    }
    
    // Transferir total acumulado
    transfer_usdc(ctx.accounts.user, total_to_claim)?;
    
    // Marcar todos como reclamados
    for report_id in reports_to_mark {
        user_rewards.claimed_reports.push(report_id);
    }
    user_rewards.total_claimed += total_to_claim;
    
    emit!(StakerRewardsClaimed {
        user: ctx.accounts.user.key(),
        reports_claimed: reports_to_mark,
        total_amount: total_to_claim,
    });
}

// Función helper para consultar rewards pendientes
pub fn get_pending_staker_rewards(user: Pubkey) -> Vec<PendingReward> {
    let user_rewards = get_user_rewards(user);
    let all_reports = get_all_platform_reports();
    
    let mut pending = Vec::new();
    
    for report in all_reports {
        // Si no lo ha reclamado Y estaba staking
        if !user_rewards.claimed_reports.contains(&report.report_id) &&
           was_user_staking_at(user, report.timestamp) {
            pending.push(PendingReward {
                report_id: report.report_id,
                amount: report.reward_per_staker,
                period_end: report.period_end,
            });
        }
    }
    
    pending
}
```

### 3. **Consultas para el Owner**

```rust
// Ver resumen de pagos pendientes a proveedores
pub fn get_all_pending_provider_payments() -> Vec<ProviderPaymentSummary> {
    let mut summaries = Vec::new();
    
    for provider in all_providers {
        let pending_reports = get_unpaid_reports_for_provider(provider.id);
        
        if !pending_reports.is_empty() {
            summaries.push(ProviderPaymentSummary {
                provider_id: provider.id,
                provider_name: provider.name,
                pending_reports: pending_reports.len(),
                total_pending: provider.pending_payment,
                oldest_unpaid_report: pending_reports[0].report_id,
                breakdown_by_report: pending_reports.map(|r| {
                    (r.report_id, r.payment_amount)
                }),
            });
        }
    }
    
    summaries
}

// Ver detalle específico de un proveedor
pub fn get_provider_full_history(provider_id: u16) -> ProviderHistory {
    let provider = get_provider_stats(provider_id);
    let all_reports = get_reports_with_provider(provider_id);
    
    ProviderHistory {
        provider_id,
        total_tokens_sold_alltime: provider.total_tokens_sold,
        total_earned_alltime: provider.total_earned,
        total_paid_alltime: provider.total_withdrawn,
        current_pending: provider.pending_payment,
        
        reports: all_reports.map(|r| ReportSummary {
            report_id: r.report_id,
            period: format!("{} - {}", r.period_start, r.period_end),
            tokens_sold: r.tokens_sold_period,
            payment_amount: r.payment_amount,
            paid: r.paid,
            paid_date: r.payment_timestamp,
        })
    }
}
```

## 🔧 Instrucciones Actualizadas

### 1. **create_player - Incluir costo**
```rust
pub fn create_player(
    ctx: Context<CreatePlayer>,
    provider_id: u16,
    category: PlayerCategory,
    total_tokens: u32,
    token_cost_usdc: u64,        // NUEVO: Costo por token
    metadata_uri: Option<String>,
) -> Result<()>
```

### 2. **update_player - Actualizar costo**
```rust
pub fn update_player(
    ctx: Context<UpdatePlayer>,
    player_id: u16,
    // ... otros campos ...
    token_cost_usdc: Option<u64>, // Poder actualizar el costo
) -> Result<()>
```

## 🎯 Resumen del Modelo Final (ACTUALIZADO v2)

### Puntos Clave:

1. **Jugadores**: Cada uno tiene su **costo por token específico**
2. **Tracking Individual**: Se registra **cada venta de token** con todos los detalles
3. **Proveedores**: Reciben la **suma exacta** de los costos de sus tokens vendidos
4. **Ganancia**: Revenue Total - Suma de Costos = Ganancia Bruta
5. **Distribución de GANANCIA**:
   - 30% para Stakers (dividido igualmente)
   - 70% para Plataforma

### Tracking Completo de Ventas:
```
Cada venta registra:
- sale_id: ID único
- player_id: Qué jugador se vendió
- provider_id: De qué proveedor
- team_id: En qué equipo
- token_cost: Cuánto costó
- timestamp: Cuándo
- buyer: Quién compró
- team_price: Precio total del team
```

### Modelo de Almacenamiento Híbrido (Recomendado):

1. **On-chain**: 
   - Agregados (ProviderStats, Reports)
   - Totales y balances
   
2. **Eventos**:
   - Detalles de cada venta individual
   - Indexable off-chain para queries

3. **Ventajas**:
   - Eficiente en costos
   - Queryable con indexador
   - Verificable on-chain

### Flujo Completo:

```
1. buy_team
   ├─► Crear TokenSale para cada jugador
   ├─► Emitir evento TokenSold
   ├─► Actualizar ProviderStats (agregados)
   └─► Actualizar GameState (totales)

2. generate_report
   ├─► Agregar ventas del período
   ├─► Calcular costos totales
   ├─► Calcular ganancia y distribución
   └─► Crear ReportProviderDetail con sale_ids

3. Queries disponibles
   ├─► Ventas por jugador
   ├─► Ventas por proveedor
   ├─► Ventas por período
   └─► Top jugadores vendidos
```

## ✅ Checklist Final Completo:

- [ ] Confirmar modelo híbrido (agregados on-chain + eventos)
- [ ] Confirmar tracking individual de cada venta
- [ ] Confirmar costo variable por jugador
- [ ] Confirmar distribución: 30% stakers, 70% platform
- [ ] Confirmar snapshot method para stakers
- [ ] Definir infraestructura de indexación para eventos

## 🚀 Beneficios del Sistema Completo:

1. **Transparencia Total**: Cada token vendido es rastreable
2. **Verificabilidad**: Proveedores pueden auditar venta por venta
3. **Analytics**: Datos ricos para decisiones de negocio
4. **Flexibilidad**: Costos ajustables por jugador individual
5. **Escalabilidad**: Modelo híbrido eficiente en costos

¿Listo para implementar?

### 4. **Flexibilidad de Períodos**

```rust
// Períodos pueden ser de cualquier duración
pub fn generate_platform_report(ctx: Context<GenerateReport>) -> Result<()> {
    let last_report_time = game_state.current_period_start;
    let now = clock.unix_timestamp;
    
    // Validar período mínimo (ej: 1 día)
    require!(
        now - last_report_time >= 86400,
        "Período mínimo es 1 día"
    );
    
    // El período es desde last_report hasta ahora
    report.period_start = last_report_time;
    report.period_end = now;
    report.period_days = (now - last_report_time) / 86400;
}
```

### 5. **Verificación de Integridad**

```rust
// Siempre se puede verificar que los números cuadren
pub fn verify_report_integrity(report_id: u64) {
    let report = get_report(report_id);
    
    // 1. Verificar distribución
    let total_distributed = 
        report.provider_payments_total + 
        report.staker_pool_amount + 
        report.platform_net_profit;
    
    assert!(total_distributed == report.period_revenue);
    
    // 2. Verificar stakers
    let expected_staker_total = 
        report.reward_per_staker * report.stakers_count_snapshot;
    
    assert!(expected_staker_total == report.staker_pool_amount);
    
    // 3. Verificar que no se pague de más
    assert!(report.stakers_claimed <= report.stakers_count_snapshot);
}
```

### 6. **Casos de Borde Manejados**

```rust
// División exacta para stakers
let reward_per_staker = staker_pool / stakers_count;
let dust = staker_pool % stakers_count;  // El "resto"

// El dust se puede:
// - Agregar a la plataforma
// - Acumular para siguiente período
// - Dar al primer staker que reclame

// Sin stakers activos
if stakers_count == 0 {
    // Todo va a la plataforma
    platform_net += staker_pool;
    staker_pool = 0;
}
```

### 📊 **Ejemplos de Uso**

#### Para el Owner - Pagar Proveedores:

```typescript
// 1. Ver todos los pagos pendientes
const pendingPayments = await getPendingProviderPayments();
/*
[
  {
    provider_id: 1,
    provider_name: "Sports Agency A",
    pending_reports: 2,
    total_pending: $1,250,
    breakdown: [
      { report_id: 5, amount: $750 },
      { report_id: 6, amount: $500 }
    ]
  },
  ...
]
*/

// 2. Ver detalle de un proveedor específico
const details = await getProviderPaymentDetails(1, 6);
/*
{
  provider_id: 1,
  report_id: 6,
  total_tokens_sold: 250,
  total_payment: $500,
  already_paid: false,
  sales_breakdown: [
    {
      player_id: 10,
      player_name: "Messi",
      token_cost: $2.00,
      team_id: 12345,
      buyer: "Gx3k...",
      timestamp: "2024-01-15 10:30"
    },
    // ... 249 más ventas
  ]
}
*/

// 3. Después de pagar off-chain, marcar como pagado
await markProviderPaid(1, 6);
```

#### Para Stakers - Reclamar Rewards:

```typescript
// 1. Ver rewards pendientes
const pending = await getPendingStakerRewards(userWallet);
/*
[
  { report_id: 4, amount: $25, period_end: "2024-01-01" },
  { report_id: 5, amount: $30, period_end: "2024-01-08" },
  { report_id: 6, amount: $28, period_end: "2024-01-15" }
]
*/

// 2. Reclamar uno o varios reportes
// Opción A: Reclamar solo el más reciente
await claimStakingRewards([6]);

// Opción B: Reclamar todos acumulados
await claimStakingRewards([4, 5, 6]); // Recibe $83 total

// 3. Si intenta reclamar de nuevo
await claimStakingRewards([5]); // Error: "Reporte 5 ya fue reclamado"
```

### ✅ **Garantías del Sistema Actualizado**

1. **Proveedores**: 
   - Owner ve exactamente cuánto pagar con detalle completo
   - Sistema marca cuando se pagó para evitar duplicados
   - Historial completo disponible

2. **Stakers**:
   - Pueden reclamar reportes acumulados (no pierden rewards)
   - No pueden reclamar dos veces el mismo reporte
   - Ven todos sus rewards pendientes

3. **Flexibilidad total**: Reportes semanales, mensuales, o custom
4. **Verificable**: Todo cuadra matemáticamente
5. **Transparente**: Detalle completo de cada transacción