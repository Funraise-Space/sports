use anchor_lang::prelude::*;

declare_id!("5BqZmNdV2dgBEJ4aoid1LrKzXtJJR1fLskKUzygynDU9");

#[program]
pub mod sports {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        game_state.owner = ctx.accounts.user.key();
        game_state.staff = Vec::new();
        game_state.players = Vec::new();
        game_state.next_player_id = 1;
        msg!("Game State initialized with owner: {}", ctx.accounts.user.key());
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
        
        // Assign internal ID
        let player_id = game_state.next_player_id;
        
        // Create complete player in PDA
        player_account.id = player_id;
        player_account.provider_id = provider_id;
        player_account.category = category.clone();
        player_account.total_tokens = total_tokens;
        player_account.tokens_sold = 0;
        player_account.metadata_uri = metadata_uri;

        // Add minimal information to game state vec
        let player_summary = PlayerSummary {
            id: player_id,
            category: category.clone(),
            available_tokens: total_tokens,
        };
        
        game_state.players.push(player_summary);
        game_state.next_player_id += 1;

        msg!("Player created with ID: {}, Category: {:?}", player_id, category);
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
}

// Helper function to check if user is owner or staff
fn is_authorized(user_key: &Pubkey, game_state: &GameState) -> bool {
    user_key == &game_state.owner || game_state.staff.contains(user_key)
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

// Main game account containing vec with minimal data
#[account]
pub struct GameState {
    pub owner: Pubkey,
    pub staff: Vec<Pubkey>,
    pub players: Vec<PlayerSummary>,
    pub next_player_id: u16,
}

impl GameState {
    // Space estimation: 8 (discriminator) + 32 (owner) + 4 (staff vec len) + (3 staff * 32) + 4 (players vec len) + (1300 players * PlayerSummary::SIZE) + 2 (next_player_id u16)
    // Total: 8 + 32 + 4 + 96 + 4 + (1300 * 7) + 2 = 9,246 bytes (within Solana's 10KB limit)
    pub const SPACE: usize = 8 + 32 + 4 + (3 * 32) + 4 + (1300 * PlayerSummary::SIZE) + 2;
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
}
