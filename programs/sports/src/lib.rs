use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;

declare_id!("5BqZmNdV2dgBEJ4aoid1LrKzXtJJR1fLskKUzygynDU9");

#[program]
pub mod sports {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        team_price_a: u64,
        team_price_b: u64,
        team_price_c: u64,
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        game_state.owner = ctx.accounts.user.key();
        game_state.staff = Vec::new();
        game_state.players = Vec::new();
        game_state.next_player_id = 1;
        
        // Validate prices are reasonable (non-zero and less than $1000)
        require!(
            team_price_a > 0 && team_price_a <= 1_000_000_000, // Max $1000
            SportsError::InvalidPrice
        );
        require!(
            team_price_b > 0 && team_price_b <= 1_000_000_000,
            SportsError::InvalidPrice
        );
        require!(
            team_price_c > 0 && team_price_c <= 1_000_000_000,
            SportsError::InvalidPrice
        );
        
        // Initialize team prices with provided values
        game_state.team_price_a = team_price_a;
        game_state.team_price_b = team_price_b;
        game_state.team_price_c = team_price_c;
        
        msg!("Game State initialized with owner: {}", ctx.accounts.user.key());
        msg!("Team prices - A: ${}, B: ${}, C: ${}", 
            game_state.team_price_a / 1_000_000,
            game_state.team_price_b / 1_000_000,
            game_state.team_price_c / 1_000_000
        );
        Ok(())
    }

    pub fn create_player(
        ctx: Context<CreatePlayer>,
        provider_id: u16,
        category: PlayerCategory,
        total_tokens: u32,
        metadata_uri: Option<String>,
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        let player_account = &mut ctx.accounts.player_account;
        
        // Only owner or staff can create players
        require!(
            is_authorized(&ctx.accounts.user.key(), game_state),
            SportsError::UnauthorizedAccess
        );
        
        // Use business logic function
        let (player_data, player_summary) = create_player_data(
            game_state.next_player_id,
            provider_id,
            category,
            total_tokens,
            metadata_uri,
        );
        
        // Apply to accounts
        apply_player_data(player_account, &player_data);
        game_state.players.push(player_summary);
        game_state.next_player_id += 1;

        msg!("Player created with ID: {}, Category: {:?}", player_data.id, player_data.category);
        Ok(())
    }

    pub fn add_tokens(
        ctx: Context<AddTokens>,
        player_id: u16,
        tokens_to_add: u32,
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        let player_account = &mut ctx.accounts.player_account;

        // Only owner or staff can add tokens
        require!(
            is_authorized(&ctx.accounts.user.key(), game_state),
            SportsError::UnauthorizedAccess
        );

        // Add tokens to total_tokens in PDA
        player_account.total_tokens = player_account.total_tokens
            .checked_add(tokens_to_add)
            .ok_or(SportsError::TokenOverflow)?;

        // Update available_tokens in game state vec
        if let Some(player_summary) = game_state.players.iter_mut().find(|p| p.id == player_id) {
            player_summary.available_tokens = player_account.total_tokens - player_account.tokens_sold;
        }

        msg!("Added {} tokens to player {}, new total: {}", 
             tokens_to_add, player_id, player_account.total_tokens);
        Ok(())
    }

    pub fn reset_available_tokens(
        ctx: Context<AddTokens>,
        player_id: u16,
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        let player_account = &mut ctx.accounts.player_account;

        // Only owner or staff can reset tokens
        require!(
            is_authorized(&ctx.accounts.user.key(), game_state),
            SportsError::UnauthorizedAccess
        );

        // Mark all tokens as sold (available tokens = 0)
        player_account.tokens_sold = player_account.total_tokens;

        // Update available_tokens to 0 in game state vec
        if let Some(player_summary) = game_state.players.iter_mut().find(|p| p.id == player_id) {
            player_summary.available_tokens = 0;
        }

        msg!("Reset available tokens to 0 for player {}", player_id);
        Ok(())
    }

    pub fn update_player(
        ctx: Context<UpdatePlayer>,
        player_id: u16,
        provider_id: Option<u16>,
        category: Option<PlayerCategory>,
        total_tokens: Option<u32>,
        metadata_uri: Option<Option<String>>, // Option<Option<String>> to allow setting to None
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        let player_account = &mut ctx.accounts.player_account;

        // Only owner or staff can update players
        require!(
            is_authorized(&ctx.accounts.user.key(), game_state),
            SportsError::UnauthorizedAccess
        );

        // Use business logic function
        let updated_data = update_player_data(
            player_account,
            provider_id,
            category.clone(),
            total_tokens,
            metadata_uri,
        )?;

        // Apply updates to PDA
        apply_player_updates(player_account, &updated_data);

        // Update summary in game state vec if category or tokens changed
        if category.is_some() || total_tokens.is_some() {
            if let Some(player_summary) = game_state.players.iter_mut().find(|p| p.id == player_id) {
                if let Some(new_category) = category {
                    player_summary.category = new_category;
                }
                player_summary.available_tokens = player_account.total_tokens - player_account.tokens_sold;
            }
        }

        msg!("Player {} updated successfully", player_id);
        Ok(())
    }

    pub fn add_staff_member(
        ctx: Context<ManageStaff>,
        staff_member: Pubkey,
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;

        // Only owner or staff can add staff
        require!(
            is_authorized(&ctx.accounts.user.key(), game_state),
            SportsError::UnauthorizedAccess
        );

        // Check maximum staff limit (3)
        require!(game_state.staff.len() < 3, SportsError::StaffLimitExceeded);

        // Check if staff member already exists
        require!(!game_state.staff.contains(&staff_member), SportsError::StaffAlreadyExists);

        // Add staff member
        game_state.staff.push(staff_member);

        msg!("Staff member added: {}", staff_member);
        Ok(())
    }

    pub fn remove_staff_member(
        ctx: Context<ManageStaff>,
        staff_member: Pubkey,
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;

        // Only owner or staff can remove staff
        require!(
            is_authorized(&ctx.accounts.user.key(), game_state),
            SportsError::UnauthorizedAccess
        );

        // Find and remove staff member
        if let Some(index) = game_state.staff.iter().position(|&x| x == staff_member) {
            game_state.staff.remove(index);
            msg!("Staff member removed: {}", staff_member);
        } else {
            return Err(SportsError::StaffNotFound.into());
        }

        Ok(())
    }

    pub fn buy_team(
        ctx: Context<BuyTeam>,
        package: TeamPackage,
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        let clock = &ctx.accounts.clock;
        
        // Get available players
        let available_players: Vec<(usize, &PlayerSummary)> = game_state.players
            .iter()
            .enumerate()
            .filter(|(_, p)| p.available_tokens > 0)
            .collect();
        
        // Check if we have enough players
        let total_needed = package.total_players();
        
        require!(
            available_players.len() >= total_needed,
            SportsError::InsufficientPlayersAvailable
        );
        
        // Generate entropy for randomness
        let entropy = generate_entropy(
            &ctx.accounts.user.key(),
            clock,
        );
        
        // Select players based on package type
        let selected_indices = select_team_players(&available_players, &package, &entropy)?;
        
        // Update tokens for selected players
        let player_ids = update_team_tokens(game_state, &selected_indices)?;
        
        // Create team purchase record
        let team_purchase = create_team_purchase(
            ctx.accounts.user.key(),
            package,
            player_ids,
            clock,
            game_state,
        );
        
        // TODO: Transfer USDC payment
        // TODO: Mint Team NFT
        
        msg!("Team purchased: {:?}", team_purchase);
        msg!("Selected player IDs: {:?}", team_purchase.player_ids);
        msg!("Price paid (USDC): ${}.{:02}", 
            team_purchase.price_paid_usdc / 1_000_000,
            (team_purchase.price_paid_usdc % 1_000_000) / 10_000
        );
        
        Ok(())
    }

    pub fn update_team_prices(
        ctx: Context<UpdateTeamPrices>,
        price_a: u64,
        price_b: u64,
        price_c: u64,
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;

        // Only owner can update prices
        require!(
            ctx.accounts.user.key() == game_state.owner,
            SportsError::UnauthorizedAccess
        );

        // Validate prices are reasonable (non-zero and less than $1000)
        require!(
            price_a > 0 && price_a <= 1_000_000_000, // Max $1000
            SportsError::InvalidPrice
        );
        require!(
            price_b > 0 && price_b <= 1_000_000_000,
            SportsError::InvalidPrice
        );
        require!(
            price_c > 0 && price_c <= 1_000_000_000,
            SportsError::InvalidPrice
        );

        game_state.team_price_a = price_a;
        game_state.team_price_b = price_b;
        game_state.team_price_c = price_c;

        msg!("Team prices updated - A: ${}, B: ${}, C: ${}", 
            price_a / 1_000_000,
            price_b / 1_000_000,
            price_c / 1_000_000
        );

        Ok(())
    }
}

// Helper function to check if user is owner or staff
fn is_authorized(user_key: &Pubkey, game_state: &GameState) -> bool {
    user_key == &game_state.owner || game_state.staff.contains(user_key)
}

// Pure business logic for creating player data
fn create_player_data(
    player_id: u16,
    provider_id: u16,
    category: PlayerCategory,
    total_tokens: u32,
    metadata_uri: Option<String>,
) -> (PlayerData, PlayerSummary) {
    let player_data = PlayerData {
        id: player_id,
        provider_id,
        category: category.clone(),
        total_tokens,
        tokens_sold: 0,
        metadata_uri,
    };
    
    let player_summary = PlayerSummary {
        id: player_id,
        category,
        available_tokens: total_tokens,
    };
    
    (player_data, player_summary)
}

// Pure function to apply player data to account
fn apply_player_data(player_account: &mut Player, player_data: &PlayerData) {
    player_account.id = player_data.id;
    player_account.provider_id = player_data.provider_id;
    player_account.category = player_data.category.clone();
    player_account.total_tokens = player_data.total_tokens;
    player_account.tokens_sold = player_data.tokens_sold;
    player_account.metadata_uri = player_data.metadata_uri.clone();
}

// Pure business logic for updating player data
fn update_player_data(
    current_player: &Player,
    provider_id: Option<u16>,
    category: Option<PlayerCategory>,
    total_tokens: Option<u32>,
    metadata_uri: Option<Option<String>>,
) -> Result<PlayerUpdateData> {
    // Validate that new total_tokens is not less than tokens_sold
    if let Some(new_total) = total_tokens {
        if new_total < current_player.tokens_sold {
            return Err(SportsError::InvalidTokenUpdate.into());
        }
    }

    let update_data = PlayerUpdateData {
        provider_id,
        category,
        total_tokens,
        metadata_uri,
    };

    Ok(update_data)
}

// Pure function to apply updates to player account
fn apply_player_updates(player_account: &mut Player, update_data: &PlayerUpdateData) {
    if let Some(provider_id) = update_data.provider_id {
        player_account.provider_id = provider_id;
    }
    if let Some(category) = &update_data.category {
        player_account.category = category.clone();
    }
    if let Some(total_tokens) = update_data.total_tokens {
        player_account.total_tokens = total_tokens;
    }
    if let Some(metadata_uri) = &update_data.metadata_uri {
        player_account.metadata_uri = metadata_uri.clone();
    }
}

// Struct for pure player data (not tied to Anchor)
#[derive(Clone, Debug, PartialEq)]
struct PlayerData {
    id: u16,
    provider_id: u16,
    category: PlayerCategory,
    total_tokens: u32,
    tokens_sold: u32,
    metadata_uri: Option<String>,
}

// Struct for player update data
#[derive(Clone, Debug, PartialEq)]
struct PlayerUpdateData {
    provider_id: Option<u16>,
    category: Option<PlayerCategory>,
    total_tokens: Option<u32>,
    metadata_uri: Option<Option<String>>,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = user,
        space = GameState::SPACE,
        seeds = [b"game_state"],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(provider_id: u16, category: PlayerCategory, total_tokens: u32, metadata_uri: Option<String>)]
pub struct CreatePlayer<'info> {
    #[account(
        mut,
        seeds = [b"game_state"],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        init,
        payer = user,
        space = Player::SPACE,
        seeds = [b"player", game_state.next_player_id.to_le_bytes().as_ref(), game_state.key().as_ref()],
        bump
    )]
    pub player_account: Account<'info, Player>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(player_id: u16)]
pub struct AddTokens<'info> {
    #[account(
        mut,
        seeds = [b"game_state"],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        mut,
        seeds = [b"player", player_id.to_le_bytes().as_ref(), game_state.key().as_ref()],
        bump
    )]
    pub player_account: Account<'info, Player>,
    
    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct ManageStaff<'info> {
    #[account(
        mut,
        seeds = [b"game_state"],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(player_id: u16)]
pub struct UpdatePlayer<'info> {
    #[account(
        mut,
        seeds = [b"game_state"],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        mut,
        seeds = [b"player", player_id.to_le_bytes().as_ref(), game_state.key().as_ref()],
        bump
    )]
    pub player_account: Account<'info, Player>,
    
    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct BuyTeam<'info> {
    #[account(
        mut,
        seeds = [b"game_state"],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// Clock for entropy generation
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct UpdateTeamPrices<'info> {
    #[account(
        mut,
        seeds = [b"game_state"],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(mut)]
    pub user: Signer<'info>,
}

// Main game account containing vec with minimal data
#[account]
pub struct GameState {
    pub owner: Pubkey,
    pub staff: Vec<Pubkey>,
    pub players: Vec<PlayerSummary>,
    pub next_player_id: u16,
    pub team_price_a: u64,
    pub team_price_b: u64,
    pub team_price_c: u64,
}

impl GameState {
    // Space estimation: 8 (discriminator) + 32 (owner) + 4 (staff vec len) + (3 staff * 32) + 4 (players vec len) + (1300 players * PlayerSummary::SIZE) + 2 (next_player_id u16) + 24 (3 team prices u64)
    // Total: 8 + 32 + 4 + 96 + 4 + (1300 * 7) + 2 + 24 = 9,270 bytes (within Solana's 10KB limit)
    pub const SPACE: usize = 8 + 32 + 4 + (3 * 32) + 4 + (1300 * PlayerSummary::SIZE) + 2 + 24;
}

// Individual PDA account for each player with complete information
#[account]
pub struct Player {
    pub id: u16,
    pub provider_id: u16,
    pub category: PlayerCategory,
    pub total_tokens: u32,
    pub tokens_sold: u32,
    pub metadata_uri: Option<String>,
}

impl Player {
    // Space: 8 (discriminator) + 2 (id u16) + 2 (provider_id) + 1 (category) + 4 (total_tokens) + 4 (tokens_sold) + 4 (option) + 100 (string max)
    pub const SPACE: usize = 8 + 2 + 2 + 1 + 4 + 4 + 4 + 100;
}

// Minimal structure for the vec in GameState
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PlayerSummary {
    pub id: u16,
    pub category: PlayerCategory,
    pub available_tokens: u32,
}

impl PlayerSummary {
    pub const SIZE: usize = 2 + 1 + 4; // id (u16) + category + available_tokens
}

// Enum for player categories
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum PlayerCategory {
    Bronze,
    Silver,
    Gold,
}

// Enum for team packages
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum TeamPackage {
    A, // 5 random players
    B, // 4 random + 1 Silver/Gold
    C, // 3 random + 2 Silver/Gold
}

impl TeamPackage {
    // Get price from game state
    pub fn price_usdc(&self, game_state: &GameState) -> u64 {
        match self {
            TeamPackage::A => game_state.team_price_a,
            TeamPackage::B => game_state.team_price_b,
            TeamPackage::C => game_state.team_price_c,
        }
    }
    
    pub fn total_players(&self) -> usize {
        5 // All packages have 5 players
    }
}

// Struct to represent selected players for a team
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct TeamPurchase {
    pub buyer: Pubkey,
    pub package: TeamPackage,
    pub player_ids: Vec<u16>,
    pub purchase_timestamp: i64,
    pub purchase_slot: u64,
    pub price_paid_usdc: u64,
}

// Custom errors
#[error_code]
pub enum SportsError {
    #[msg("Insufficient tokens available")]
    InsufficientTokens,
    #[msg("Invalid player ID")]
    InvalidPlayerId,
    #[msg("Token overflow")]
    TokenOverflow,
    #[msg("Unauthorized access")]
    UnauthorizedAccess,
    #[msg("Staff limit exceeded")]
    StaffLimitExceeded,
    #[msg("Staff already exists")]
    StaffAlreadyExists,
    #[msg("Staff not found")]
    StaffNotFound,
    #[msg("Invalid token update")]
    InvalidTokenUpdate,
    #[msg("Insufficient players available")]
    InsufficientPlayersAvailable,
    #[msg("Insufficient premium players")]
    InsufficientPremiumPlayers,
    #[msg("Random selection failed")]
    RandomSelectionFailed,
    #[msg("Invalid price")]
    InvalidPrice,
}

// Function to generate entropy for randomness
fn generate_entropy(
    buyer: &Pubkey,
    clock: &Clock,
) -> [u8; 32] {
    use anchor_lang::solana_program::keccak;
    
    // TODO: Get from Chainlink oracle
    let chainlink_price = 1000000u64; // Placeholder: $1.00 with 6 decimals
    
    let mut data = Vec::new();
    data.extend_from_slice(&clock.slot.to_le_bytes());
    data.extend_from_slice(&clock.unix_timestamp.to_le_bytes());
    data.extend_from_slice(buyer.as_ref());
    data.extend_from_slice(&chainlink_price.to_le_bytes());
    
    keccak::hash(&data).0
}

// Function to select random players
fn select_random_players(
    available_players: &[(usize, &PlayerSummary)],
    count: usize,
    entropy: &[u8; 32],
    exclude_indices: Option<&Vec<usize>>,
) -> Result<Vec<usize>> {
    let mut selected_indices = Vec::new();
    let mut used_indices = std::collections::HashSet::new();
    
    // Add excluded indices to used set
    if let Some(excluded) = exclude_indices {
        for &idx in excluded {
            used_indices.insert(idx);
        }
    }
    
    let mut iteration = 0u8;
    while selected_indices.len() < count {
        // Create additional entropy for each iteration
        let mut hash_input = entropy.to_vec();
        hash_input.push(iteration);
        let hash = anchor_lang::solana_program::keccak::hash(&hash_input);
        
        // Use first 8 bytes as u64 for index calculation
        let random_value = u64::from_le_bytes(hash.0[0..8].try_into().unwrap());
        let index = (random_value as usize) % available_players.len();
        
        let actual_index = available_players[index].0;
        
        // Skip if already selected
        if !used_indices.contains(&actual_index) {
            selected_indices.push(actual_index);
            used_indices.insert(actual_index);
        }
        
        iteration = iteration.wrapping_add(1);
        
        // Prevent infinite loop
        if iteration == 255 {
            return Err(SportsError::RandomSelectionFailed.into());
        }
    }
    
    Ok(selected_indices)
}

// Function to select players for a team based on package type
fn select_team_players(
    available_players: &[(usize, &PlayerSummary)],
    package: &TeamPackage,
    entropy: &[u8; 32],
) -> Result<Vec<usize>> {
    match package {
        TeamPackage::A => {
            // Select 5 random players
            select_random_players(available_players, 5, entropy, None)
        },
        TeamPackage::B => {
            // Select 4 random players + 1 Silver/Gold
            let mut indices = select_random_players(available_players, 4, entropy, None)?;
            let premium_players: Vec<(usize, &PlayerSummary)> = available_players
                .iter()
                .filter(|(_, p)| p.category == PlayerCategory::Silver || p.category == PlayerCategory::Gold)
                .copied()
                .collect();
            
            require!(
                !premium_players.is_empty(),
                SportsError::InsufficientPremiumPlayers
            );
            
            let premium_selected = select_random_players(&premium_players, 1, entropy, Some(&indices))?;
            indices.extend(premium_selected);
            Ok(indices)
        },
        TeamPackage::C => {
            // Select 3 random players + 2 Silver/Gold
            let mut indices = select_random_players(available_players, 3, entropy, None)?;
            let premium_players: Vec<(usize, &PlayerSummary)> = available_players
                .iter()
                .filter(|(_, p)| p.category == PlayerCategory::Silver || p.category == PlayerCategory::Gold)
                .copied()
                .collect();
            
            require!(
                premium_players.len() >= 2,
                SportsError::InsufficientPremiumPlayers
            );
            
            let premium_selected = select_random_players(&premium_players, 2, entropy, Some(&indices))?;
            indices.extend(premium_selected);
            Ok(indices)
        },
    }
}

// Function to update token counts for selected players
fn update_team_tokens(
    game_state: &mut GameState,
    selected_indices: &[usize],
) -> Result<Vec<u16>> {
    let mut player_ids = Vec::new();
    
    for &idx in selected_indices {
        let player_summary = &mut game_state.players[idx];
        player_summary.available_tokens = player_summary.available_tokens
            .checked_sub(1)
            .ok_or(SportsError::InsufficientTokens)?;
        player_ids.push(player_summary.id);
        
        // TODO: Update player PDA tokens_sold
        // This requires passing player accounts through remaining_accounts
        // and will be implemented when we add the full integration
    }
    
    Ok(player_ids)
}

// Function to create a team purchase record
fn create_team_purchase(
    buyer: Pubkey,
    package: TeamPackage,
    player_ids: Vec<u16>,
    clock: &Clock,
    game_state: &GameState,
) -> TeamPurchase {
    TeamPurchase {
        buyer,
        package: package.clone(),
        player_ids,
        purchase_timestamp: clock.unix_timestamp,
        purchase_slot: clock.slot,
        price_paid_usdc: package.price_usdc(game_state),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_is_authorized_with_owner() {
        let owner = Pubkey::new_unique();
        let game_state = GameState {
            owner,
            staff: Vec::new(),
            players: Vec::new(),
            next_player_id: 1,
            team_price_a: 0,
            team_price_b: 0,
            team_price_c: 0,
        };
        
        assert!(is_authorized(&owner, &game_state));
    }
    
    #[test]
    fn test_is_authorized_with_staff() {
        let owner = Pubkey::new_unique();
        let staff_member = Pubkey::new_unique();
        let game_state = GameState {
            owner,
            staff: vec![staff_member],
            players: Vec::new(),
            next_player_id: 1,
            team_price_a: 0,
            team_price_b: 0,
            team_price_c: 0,
        };
        
        assert!(is_authorized(&staff_member, &game_state));
    }
    
    #[test]
    fn test_is_authorized_with_unauthorized_user() {
        let owner = Pubkey::new_unique();
        let unauthorized = Pubkey::new_unique();
        let game_state = GameState {
            owner,
            staff: Vec::new(),
            players: Vec::new(),
            next_player_id: 1,
            team_price_a: 0,
            team_price_b: 0,
            team_price_c: 0,
        };
        
        assert!(!is_authorized(&unauthorized, &game_state));
    }
    
    #[test]
    fn test_player_summary_size() {
        assert_eq!(PlayerSummary::SIZE, 7); // 2 + 1 + 4
    }
    
    #[test]
    fn test_game_state_space_calculation() {
        // Verify the space calculation is correct
        let expected = 8 + 32 + 4 + (3 * 32) + 4 + (1300 * 7) + 2 + 24;
        assert_eq!(GameState::SPACE, expected);
        assert_eq!(GameState::SPACE, 9270);
    }
    
    #[test]
    fn test_player_space_calculation() {
        // Verify the space calculation is correct
        let expected = 8 + 2 + 2 + 1 + 4 + 4 + 4 + 100;
        assert_eq!(Player::SPACE, expected);
        assert_eq!(Player::SPACE, 125);
    }
    
    #[test]
    fn test_create_player_data() {
        let player_id = 5;
        let provider_id = 1001;
        let category = PlayerCategory::Gold;
        let total_tokens = 1500;
        let metadata_uri = Some("https://example.com/metadata.json".to_string());
        
        let (player_data, player_summary) = create_player_data(
            player_id,
            provider_id,
            category.clone(),
            total_tokens,
            metadata_uri.clone(),
        );
        
        // Verify player data
        assert_eq!(player_data.id, player_id);
        assert_eq!(player_data.provider_id, provider_id);
        assert_eq!(player_data.category, category);
        assert_eq!(player_data.total_tokens, total_tokens);
        assert_eq!(player_data.tokens_sold, 0);
        assert_eq!(player_data.metadata_uri, metadata_uri);
        
        // Verify player summary
        assert_eq!(player_summary.id, player_id);
        assert_eq!(player_summary.category, category);
        assert_eq!(player_summary.available_tokens, total_tokens);
    }
    
    #[test]
    fn test_create_player_data_without_metadata() {
        let (player_data, player_summary) = create_player_data(
            1,
            2001,
            PlayerCategory::Bronze,
            500,
            None,
        );
        
        assert_eq!(player_data.id, 1);
        assert_eq!(player_data.provider_id, 2001);
        assert_eq!(player_data.category, PlayerCategory::Bronze);
        assert_eq!(player_data.total_tokens, 500);
        assert_eq!(player_data.tokens_sold, 0);
        assert_eq!(player_data.metadata_uri, None);
        
        assert_eq!(player_summary.id, 1);
        assert_eq!(player_summary.category, PlayerCategory::Bronze);
        assert_eq!(player_summary.available_tokens, 500);
    }
    
    #[test]
    fn test_apply_player_data() {
        let mut player = Player {
            id: 0,
            provider_id: 0,
            category: PlayerCategory::Bronze,
            total_tokens: 0,
            tokens_sold: 0,
            metadata_uri: None,
        };
        
        let player_data = PlayerData {
            id: 10,
            provider_id: 3001,
            category: PlayerCategory::Silver,
            total_tokens: 2000,
            tokens_sold: 100,
            metadata_uri: Some("https://test.com/player.json".to_string()),
        };
        
        apply_player_data(&mut player, &player_data);
        
        assert_eq!(player.id, 10);
        assert_eq!(player.provider_id, 3001);
        assert_eq!(player.category, PlayerCategory::Silver);
        assert_eq!(player.total_tokens, 2000);
        assert_eq!(player.tokens_sold, 100);
        assert_eq!(player.metadata_uri, Some("https://test.com/player.json".to_string()));
    }
    
    #[test]
    fn test_update_player_data_valid() {
        let current_player = Player {
            id: 1,
            provider_id: 1000,
            category: PlayerCategory::Bronze,
            total_tokens: 1000,
            tokens_sold: 200,
            metadata_uri: None,
        };
        
        let result = update_player_data(
            &current_player,
            Some(2000),
            Some(PlayerCategory::Gold),
            Some(1500),
            Some(Some("https://updated.com/metadata.json".to_string())),
        );
        
        assert!(result.is_ok());
        let update_data = result.unwrap();
        assert_eq!(update_data.provider_id, Some(2000));
        assert_eq!(update_data.category, Some(PlayerCategory::Gold));
        assert_eq!(update_data.total_tokens, Some(1500));
        assert_eq!(update_data.metadata_uri, Some(Some("https://updated.com/metadata.json".to_string())));
    }
    
    #[test]
    fn test_update_player_data_invalid_tokens() {
        let current_player = Player {
            id: 1,
            provider_id: 1000,
            category: PlayerCategory::Bronze,
            total_tokens: 1000,
            tokens_sold: 500, // 500 tokens already sold
            metadata_uri: None,
        };
        
        // Try to set total_tokens to less than tokens_sold
        let result = update_player_data(
            &current_player,
            None,
            None,
            Some(300), // Less than 500 sold tokens
            None,
        );
        
        assert!(result.is_err());
    }
    
    #[test]
    fn test_apply_player_updates() {
        let mut player = Player {
            id: 1,
            provider_id: 1000,
            category: PlayerCategory::Bronze,
            total_tokens: 1000,
            tokens_sold: 200,
            metadata_uri: None,
        };
        
        let update_data = PlayerUpdateData {
            provider_id: Some(2000),
            category: Some(PlayerCategory::Silver),
            total_tokens: Some(1500),
            metadata_uri: Some(Some("https://new.com/metadata.json".to_string())),
        };
        
        apply_player_updates(&mut player, &update_data);
        
        // Check that only specified fields were updated
        assert_eq!(player.id, 1); // Should not change
        assert_eq!(player.provider_id, 2000); // Updated
        assert_eq!(player.category, PlayerCategory::Silver); // Updated
        assert_eq!(player.total_tokens, 1500); // Updated
        assert_eq!(player.tokens_sold, 200); // Should not change
        assert_eq!(player.metadata_uri, Some("https://new.com/metadata.json".to_string())); // Updated
    }
    
    #[test]
    fn test_apply_player_updates_partial() {
        let mut player = Player {
            id: 1,
            provider_id: 1000,
            category: PlayerCategory::Bronze,
            total_tokens: 1000,
            tokens_sold: 200,
            metadata_uri: Some("https://old.com/metadata.json".to_string()),
        };
        
        // Only update category
        let update_data = PlayerUpdateData {
            provider_id: None,
            category: Some(PlayerCategory::Gold),
            total_tokens: None,
            metadata_uri: None,
        };
        
        apply_player_updates(&mut player, &update_data);
        
        // Check that only category was updated
        assert_eq!(player.id, 1);
        assert_eq!(player.provider_id, 1000); // Unchanged
        assert_eq!(player.category, PlayerCategory::Gold); // Updated
        assert_eq!(player.total_tokens, 1000); // Unchanged
        assert_eq!(player.tokens_sold, 200); // Unchanged
        assert_eq!(player.metadata_uri, Some("https://old.com/metadata.json".to_string())); // Unchanged
    }
    
    #[test]
    fn test_team_package_price() {
        let game_state = GameState {
            owner: Pubkey::new_unique(),
            staff: Vec::new(),
            players: Vec::new(),
            next_player_id: 1,
            team_price_a: 10_000_000, // $10.00
            team_price_b: 15_000_000, // $15.00
            team_price_c: 20_000_000, // $20.00
        };
        
        assert_eq!(TeamPackage::A.price_usdc(&game_state), 10_000_000); // $10.00
        assert_eq!(TeamPackage::B.price_usdc(&game_state), 15_000_000); // $15.00
        assert_eq!(TeamPackage::C.price_usdc(&game_state), 20_000_000); // $20.00
    }
    
    #[test]
    fn test_team_package_total_players() {
        assert_eq!(TeamPackage::A.total_players(), 5);
        assert_eq!(TeamPackage::B.total_players(), 5);
        assert_eq!(TeamPackage::C.total_players(), 5);
    }
    
    #[test]
    fn test_generate_entropy() {
        let buyer = Pubkey::new_unique();
        let clock = Clock {
            slot: 12345,
            unix_timestamp: 1234567890,
            epoch: 123,
            epoch_start_timestamp: 1234567800,
            leader_schedule_epoch: 123,
        };
        
        let entropy = generate_entropy(&buyer, &clock);
        assert_eq!(entropy.len(), 32);
        
        // Test that different inputs produce different entropy
        let buyer2 = Pubkey::new_unique();
        let entropy2 = generate_entropy(&buyer2, &clock);
        assert_ne!(entropy, entropy2);
        
        let clock2 = Clock {
            slot: 12346,
            unix_timestamp: 1234567891,
            epoch: 123,
            epoch_start_timestamp: 1234567800,
            leader_schedule_epoch: 123,
        };
        let entropy3 = generate_entropy(&buyer, &clock2);
        assert_ne!(entropy, entropy3);
    }
    
    #[test]
    fn test_create_team_purchase() {
        let buyer = Pubkey::new_unique();
        let package = TeamPackage::B;
        let player_ids = vec![1, 2, 3, 4, 5];
        let clock = Clock {
            slot: 12345,
            unix_timestamp: 1234567890,
            epoch: 123,
            epoch_start_timestamp: 1234567800,
            leader_schedule_epoch: 123,
        };
        let game_state = GameState {
            owner: Pubkey::new_unique(),
            staff: Vec::new(),
            players: Vec::new(),
            next_player_id: 1,
            team_price_a: 10_000_000,
            team_price_b: 15_000_000,
            team_price_c: 20_000_000,
        };
        
        let team_purchase = create_team_purchase(buyer, package.clone(), player_ids.clone(), &clock, &game_state);
        
        assert_eq!(team_purchase.buyer, buyer);
        assert_eq!(team_purchase.package, package);
        assert_eq!(team_purchase.player_ids, player_ids);
        assert_eq!(team_purchase.purchase_timestamp, clock.unix_timestamp);
        assert_eq!(team_purchase.purchase_slot, clock.slot);
        assert_eq!(team_purchase.price_paid_usdc, 15_000_000); // $15.00 for package B
    }
}
