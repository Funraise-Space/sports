use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::clock::Clock;
use anchor_lang::solana_program::account_info::AccountInfo;

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
        game_state.next_team_id = 1;
        game_state.next_reward_id = 1;
        
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
        let clock = &ctx.accounts.clock;
        let user_key = ctx.accounts.user.key();
        let team_id;
        let price_paid_usdc;
        
        // Scope for mutable game_state operations
        {
            let game_state = &mut ctx.accounts.game_state;
            
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
            let entropy = generate_entropy(&user_key, clock);
            
            // Select players based on package type
            let selected_indices = select_team_players(&available_players, &package, &entropy)?;
            
            // Update tokens for selected players in game state
            let player_ids = update_team_tokens(game_state, &selected_indices)?;
            
            // Get price for team package
            price_paid_usdc = package.price_usdc(game_state);
            
            // Store current team_id before incrementing
            team_id = game_state.next_team_id;
            game_state.next_team_id += 1;
            
            // Initialize team account
            let team_account = &mut ctx.accounts.team_account;
            team_account.owner = user_key;
            team_account.player_ids = player_ids.clone();
            team_account.category = package.clone();
            team_account.created_at = clock.unix_timestamp;
            team_account.nft_mint = Pubkey::default(); // Will be set when NFT is minted
            team_account.state = TeamState::Free;
            team_account.team_id = team_id;
            
            // Create team purchase record (for logging)
            let team_purchase = TeamPurchase {
                buyer: user_key,
                package: package.clone(),
                player_ids,
                purchase_timestamp: clock.unix_timestamp,
                purchase_slot: clock.slot,
                price_paid_usdc,
            };
            
            msg!("Team purchased: {:?}", team_purchase);
            msg!("Selected player IDs: {:?}", team_purchase.player_ids);
            msg!("Price paid (USDC): ${}.{:02}", 
                team_purchase.price_paid_usdc / 1_000_000,
                (team_purchase.price_paid_usdc % 1_000_000) / 10_000
            );
        }
        
        // Now call functions that need immutable ctx
        transfer_usdc_payment(&ctx, price_paid_usdc)?;
        
        // For mint_team_nft, we need to recreate the team_purchase
        let team_purchase = TeamPurchase {
            buyer: user_key,
            package: package.clone(),
            player_ids: ctx.accounts.team_account.player_ids.clone(),
            purchase_timestamp: clock.unix_timestamp,
            purchase_slot: clock.slot,
            price_paid_usdc,
        };
        mint_team_nft(&ctx, &team_purchase)?;
        
        msg!("Team ID: {}, State: {:?}", team_id, TeamState::Free);
        
        Ok(())
    }

    pub fn update_team_prices(
        ctx: Context<UpdateTeamPrices>,
        price_a: u64,
        price_b: u64,
        price_c: u64,
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;

        // Only owner or staff can update prices
        require!(
            is_authorized(&ctx.accounts.user.key(), game_state),
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

    pub fn update_team_state(
        ctx: Context<UpdateTeamState>,
        team_id: u64,
        new_state: TeamState,
    ) -> Result<()> {
        let team_account = &mut ctx.accounts.team_account;
        let game_state = &ctx.accounts.game_state;
        
        // Only team owner or staff can update team state
        require!(
            ctx.accounts.user.key() == team_account.owner || is_authorized(&ctx.accounts.user.key(), game_state),
            SportsError::UnauthorizedAccess
        );
        
        // Validate state transitions
        match (&team_account.state, &new_state) {
            // Free teams can warm up
            (TeamState::Free, TeamState::WarmingUp) => {},
            // Warming up teams can go on field or back to free
            (TeamState::WarmingUp, TeamState::OnField) => {},
            (TeamState::WarmingUp, TeamState::Free) => {},
            // On field teams can only be marked to withdraw
            (TeamState::OnField, TeamState::ToWithdraw) => {},
            // To withdraw teams can be withdrawn (back to free)
            (TeamState::ToWithdraw, TeamState::Free) => {},
            // Invalid transition
            _ => return Err(SportsError::InvalidStateTransition.into()),
        }
        
        let old_state = team_account.state.clone();
        team_account.state = new_state.clone();
        
        // Update ActiveTeamsByPlayer if entering or leaving OnField state
        if old_state == TeamState::OnField || new_state == TeamState::OnField {
            // This will be handled in update_active_teams_tracking
        }
        
        msg!("Team {} state changed from {:?} to {:?}", team_id, old_state, new_state);
        Ok(())
    }

    pub fn register_player_reward(
        ctx: Context<RegisterPlayerReward>,
        player_id: u16,
        amount: u64,
    ) -> Result<()> {
        let game_state = &mut ctx.accounts.game_state;
        let player_reward = &mut ctx.accounts.player_reward;
        
        // Only owner or staff can register rewards
        require!(
            is_authorized(&ctx.accounts.user.key(), game_state),
            SportsError::UnauthorizedAccess
        );
        
        // Validate amount
        require!(
            amount > 0,
            SportsError::InvalidAmount
        );
        
        // Verify player exists
        require!(
            game_state.players.iter().any(|p| p.id == player_id),
            SportsError::InvalidPlayerId
        );
        
        // Initialize reward
        player_reward.player_id = player_id;
        player_reward.amount = amount;
        player_reward.distributed = false;
        player_reward.distribution_timestamp = 0;
        player_reward.reward_id = game_state.next_reward_id;
        
        game_state.next_reward_id += 1;
        
        msg!("Registered reward {} for player {}: {} USDC", 
            player_reward.reward_id, 
            player_id, 
            amount as f64 / 1_000_000.0
        );
        
        Ok(())
    }

    pub fn distribute_player_reward(
        ctx: Context<DistributePlayerReward>,
        reward_id: u64,
    ) -> Result<()> {
        let clock_timestamp = ctx.accounts.clock.unix_timestamp;
        let user_key = ctx.accounts.user.key();
        
        // Extract data before mutable borrow
        let (player_id, total_amount) = {
            let player_reward = &ctx.accounts.player_reward;
            
            // Verify reward hasn't been distributed
            require!(
                !player_reward.distributed,
                SportsError::RewardAlreadyDistributed
            );
            
            (player_reward.player_id, player_reward.amount)
        };
        
        // Check authorization
        {
            let game_state = &ctx.accounts.game_state;
            
            // Only owner or staff can distribute rewards
            require!(
                is_authorized(&user_key, game_state),
                SportsError::UnauthorizedAccess
            );
        }
        
        // Process teams from remaining_accounts
        let eligible_teams = get_eligible_teams_from_remaining_accounts(
            &ctx.remaining_accounts,
            player_id
        )?;
        
        // Verify we have eligible teams
        require!(
            !eligible_teams.is_empty(),
            SportsError::NoEligibleTeams
        );
        
        // Calculate amount per team
        let amount_per_team = calculate_reward_distribution(
            total_amount,
            eligible_teams.len() as u64
        )?;
        
        // Distribute to each eligible team
        for (team_id, team_owner) in eligible_teams.iter() {
            // Transfer USDC to team owner (stub for now)
            transfer_usdc_to_team_owner(
                &ctx,
                team_owner,
                amount_per_team
            )?;
            
            // Log distribution
            msg!("Distributed {} USDC to team {} (owner: {})", 
                amount_per_team as f64 / 1_000_000.0,
                team_id,
                team_owner
            );
        }
        
        // Mark reward as distributed
        let player_reward = &mut ctx.accounts.player_reward;
        player_reward.distributed = true;
        player_reward.distribution_timestamp = clock_timestamp;
        
        msg!("Completed distribution of reward {} for player {} - Total: {} USDC to {} teams", 
            reward_id,
            player_id,
            total_amount as f64 / 1_000_000.0,
            eligible_teams.len()
        );
        
        Ok(())
    }

    pub fn update_team_player_tokens(
        ctx: Context<UpdateTeamPlayerTokens>,
        team_id: u64,
    ) -> Result<()> {
        let team_account = &ctx.accounts.team_account;
        
        // Verify the team exists and get player IDs
        require!(
            team_account.team_id == team_id,
            SportsError::InvalidTeamId
        );
        
        // Update each player PDA from remaining accounts
        let player_ids = &team_account.player_ids;
        require!(
            ctx.remaining_accounts.len() == player_ids.len(),
            SportsError::InvalidAccountsProvided
        );
        
        for (i, &player_id) in player_ids.iter().enumerate() {
            let player_account_info = &ctx.remaining_accounts[i];
            
            // Load and update the player account
            let mut player_data = player_account_info.try_borrow_mut_data()?;
            let mut player: Player = Player::try_deserialize(&mut &player_data[8..])?;
            
            // Verify this is the correct player
            require!(
                player.id == player_id,
                SportsError::InvalidPlayerId
            );
            
            // Update tokens_sold
            player.tokens_sold = player.tokens_sold
                .checked_add(1)
                .ok_or(SportsError::TokenOverflow)?;
            
            // Serialize back
            player.try_serialize(&mut &mut player_data[8..])?;
            
            msg!("Updated player {} tokens_sold to {}", player_id, player.tokens_sold);
        }
        
        msg!("Updated tokens_sold for {} players in team {}", player_ids.len(), team_id);
        
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
    
    #[account(
        init,
        payer = user,
        space = Team::SPACE,
        seeds = [b"team", game_state.next_team_id.to_le_bytes().as_ref(), game_state.key().as_ref()],
        bump
    )]
    pub team_account: Account<'info, Team>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// Clock for entropy generation
    pub clock: Sysvar<'info, Clock>,
    
    pub system_program: Program<'info, System>,
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

#[derive(Accounts)]
#[instruction(team_id: u64)]
pub struct UpdateTeamState<'info> {
    #[account(
        mut,
        seeds = [b"game_state"],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        mut,
        seeds = [b"team", team_id.to_le_bytes().as_ref(), game_state.key().as_ref()],
        bump
    )]
    pub team_account: Account<'info, Team>,
    
    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct RegisterPlayerReward<'info> {
    #[account(
        mut,
        seeds = [b"game_state"],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        init,
        payer = user,
        space = PlayerReward::SPACE,
        seeds = [b"player_reward", game_state.next_reward_id.to_le_bytes().as_ref(), game_state.key().as_ref()],
        bump
    )]
    pub player_reward: Account<'info, PlayerReward>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(reward_id: u64)]
pub struct DistributePlayerReward<'info> {
    #[account(
        mut,
        seeds = [b"game_state"],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        mut,
        seeds = [b"player_reward", reward_id.to_le_bytes().as_ref(), game_state.key().as_ref()],
        bump
    )]
    pub player_reward: Account<'info, PlayerReward>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    /// Clock for distribution
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
#[instruction(team_id: u64)]
pub struct UpdateTeamPlayerTokens<'info> {
    #[account(
        seeds = [b"game_state"],
        bump
    )]
    pub game_state: Account<'info, GameState>,
    
    #[account(
        seeds = [b"team", team_id.to_le_bytes().as_ref(), game_state.key().as_ref()],
        bump
    )]
    pub team_account: Account<'info, Team>,
    
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
    pub next_team_id: u64,
    pub next_reward_id: u64,
}

impl GameState {
    // Space estimation: 8 (discriminator) + 32 (owner) + 4 (staff vec len) + (3 staff * 32) + 4 (players vec len) + (1300 players * PlayerSummary::SIZE) + 2 (next_player_id u16) + 24 (3 team prices u64) + 8 (next_team_id) + 8 (next_reward_id)
    // Total: 8 + 32 + 4 + 96 + 4 + (1300 * 7) + 2 + 24 + 8 + 8 = 9,286 bytes (within Solana's 10KB limit)
    pub const SPACE: usize = 8 + 32 + 4 + (3 * 32) + 4 + (1300 * PlayerSummary::SIZE) + 2 + 24 + 8 + 8;
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

// Team account representing a purchased team
#[account]
pub struct Team {
    pub owner: Pubkey,                    // 32 bytes
    pub player_ids: Vec<u16>,             // 4 + (5 * 2) = 14 bytes
    pub category: TeamPackage,            // 1 byte (enum)
    pub created_at: i64,                  // 8 bytes
    pub nft_mint: Pubkey,                 // 32 bytes
    pub state: TeamState,                 // 1 byte (enum)
    pub team_id: u64,                     // 8 bytes - unique identifier
}

impl Team {
    // Space: 8 (discriminator) + 32 (owner) + 14 (player_ids vec) + 1 (category) + 8 (created_at) + 32 (nft_mint) + 1 (state) + 8 (team_id)
    pub const SPACE: usize = 8 + 32 + 14 + 1 + 8 + 32 + 1 + 8;
}

// Account tracking active teams for each player
#[account]
pub struct ActiveTeamsByPlayer {
    pub player_id: u16,                   // 2 bytes
    pub active_team_ids: Vec<u64>,        // 4 + (max_teams * 8) bytes
}

impl ActiveTeamsByPlayer {
    // Space: 8 (discriminator) + 2 (player_id) + 4 (vec length) + (50 teams max * 8 bytes)
    pub const SPACE: usize = 8 + 2 + 4 + (50 * 8);
}

// Reward distribution record
#[account]
pub struct PlayerReward {
    pub player_id: u16,                   // 2 bytes
    pub amount: u64,                      // 8 bytes - USDC amount with 6 decimals
    pub distributed: bool,                // 1 byte
    pub distribution_timestamp: i64,      // 8 bytes
    pub reward_id: u64,                   // 8 bytes - unique identifier
}

impl PlayerReward {
    // Space: 8 (discriminator) + 2 + 8 + 1 + 8 + 8
    pub const SPACE: usize = 8 + 2 + 8 + 1 + 8 + 8;
}

// Distribution record for each team that received rewards
#[account]
pub struct TeamDistribution {
    pub team_id: u64,                     // 8 bytes
    pub reward_id: u64,                   // 8 bytes - links to PlayerReward
    pub amount_received: u64,             // 8 bytes - USDC amount
    pub timestamp: i64,                   // 8 bytes
}

impl TeamDistribution {
    // Space: 8 (discriminator) + 8 + 8 + 8 + 8
    pub const SPACE: usize = 8 + 8 + 8 + 8 + 8;
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

// Enum for team states
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum TeamState {
    Free,        // Free/Available (was Libre)
    WarmingUp,   // Warming up (was Calentando)
    OnField,     // On field/Playing (was EnCancha)
    ToWithdraw,  // To be retired/withdrawn (was ARetirar)
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
    #[msg("Invalid state transition")]
    InvalidStateTransition,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Reward already distributed")]
    RewardAlreadyDistributed,
    #[msg("No eligible teams")]
    NoEligibleTeams,
    #[msg("Invalid accounts provided")]
    InvalidAccountsProvided,
    #[msg("Invalid team ID")]
    InvalidTeamId,
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
    }
    
    Ok(player_ids)
}

// Function to transfer USDC payment (pending implementation)
fn transfer_usdc_payment(
    _ctx: &Context<BuyTeam>,
    amount: u64,
) -> Result<()> {
    // TODO: Implement USDC transfer
    // This will require:
    // 1. User's USDC token account
    // 2. Program's USDC token account (treasury)
    // 3. Token program
    // 4. Associated token program
    msg!("USDC transfer pending implementation: ${}.{:02}", 
        amount / 1_000_000,
        (amount % 1_000_000) / 10_000
    );
    Ok(())
}

// Function to mint team NFT (pending implementation)
fn mint_team_nft(
    _ctx: &Context<BuyTeam>,
    team_purchase: &TeamPurchase,
) -> Result<()> {
    // TODO: Implement NFT minting
    // This will require:
    // 1. NFT mint account
    // 2. Metadata account
    // 3. User's token account for the NFT
    // 4. Metaplex program
    msg!("NFT minting pending implementation for team: {:?}", team_purchase.player_ids);
    msg!("Package type: {:?}", team_purchase.package);
    Ok(())
}

// Function to calculate reward distribution
fn calculate_reward_distribution(
    total_amount: u64,
    num_teams: u64,
) -> Result<u64> {
    // Simple equal distribution
    if num_teams == 0 {
        return Err(SportsError::NoEligibleTeams.into());
    }
    
    Ok(total_amount / num_teams)
}

// Function to verify team has player and is on field
fn is_team_eligible(
    team: &Team,
    player_id: u16,
) -> bool {
    team.state == TeamState::OnField && team.player_ids.contains(&player_id)
}

// Function to get eligible teams from remaining accounts
fn get_eligible_teams_from_remaining_accounts<'info>(
    remaining_accounts: &[AccountInfo<'info>],
    player_id: u16,
) -> Result<Vec<(u64, Pubkey)>> {  // Return (team_id, owner) instead of full Team
    let mut eligible_teams = Vec::new();
    
    // Process remaining accounts in pairs (team_account, team_owner_info)
    if remaining_accounts.len() % 2 != 0 {
        return Err(SportsError::InvalidAccountsProvided.into());
    }
    
    for i in (0..remaining_accounts.len()).step_by(2) {
        let team_account_info = &remaining_accounts[i];
        let _team_owner_info = &remaining_accounts[i + 1];
        
        // Deserialize team account
        let team_data = team_account_info.try_borrow_data()?;
        
        // Skip if not enough data for discriminator
        if team_data.len() < 8 {
            continue;
        }
        
        // Try to deserialize as Team
        match Team::try_deserialize(&mut &team_data[8..]) {
            Ok(team) => {
                // Check if team is eligible
                if is_team_eligible(&team, player_id) {
                    eligible_teams.push((team.team_id, team.owner));
                }
            }
            Err(_) => {
                // Skip if not a valid Team account
                continue;
            }
        }
    }
    
    Ok(eligible_teams)
}

// Function to transfer USDC to team owner (stub)
fn transfer_usdc_to_team_owner(
    _ctx: &Context<DistributePlayerReward>,
    team_owner: &Pubkey,
    amount: u64,
) -> Result<()> {
    // TODO: Implement USDC transfer
    // This will require:
    // 1. Treasury USDC token account
    // 2. Team owner's USDC token account
    // 3. Token program
    // 4. SPL token transfer instruction
    
    msg!("USDC transfer pending implementation: {} USDC to {}", 
        amount as f64 / 1_000_000.0,
        team_owner
    );
    
    Ok(())
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
            next_team_id: 0,
            next_reward_id: 0,
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
            next_team_id: 0,
            next_reward_id: 0,
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
            next_team_id: 0,
            next_reward_id: 0,
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
        let expected = 8 + 32 + 4 + (3 * 32) + 4 + (1300 * 7) + 2 + 24 + 8 + 8;
        assert_eq!(GameState::SPACE, expected);
        assert_eq!(GameState::SPACE, 9286);
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
            next_team_id: 0,
            next_reward_id: 0,
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
            next_team_id: 1,
            next_reward_id: 0,
        };
        
        // Test TeamPurchase creation directly
        let team_purchase = TeamPurchase {
            buyer,
            package: package.clone(),
            player_ids: player_ids.clone(),
            purchase_timestamp: clock.unix_timestamp,
            purchase_slot: clock.slot,
            price_paid_usdc: package.price_usdc(&game_state),
        };
        
        assert_eq!(team_purchase.buyer, buyer);
        assert_eq!(team_purchase.package, package);
        assert_eq!(team_purchase.player_ids, player_ids);
        assert_eq!(team_purchase.purchase_timestamp, clock.unix_timestamp);
        assert_eq!(team_purchase.purchase_slot, clock.slot);
        assert_eq!(team_purchase.price_paid_usdc, 15_000_000); // $15.00 for package B
    }
    
    #[test]
    fn test_calculate_reward_distribution() {
        // Test equal distribution
        let total = 1_000_000; // 1 USDC
        let teams = 4;
        let per_team = calculate_reward_distribution(total, teams).unwrap();
        assert_eq!(per_team, 250_000); // 0.25 USDC each
        
        // Test with zero teams
        let result = calculate_reward_distribution(total, 0);
        assert!(result.is_err());
    }
    
    #[test]
    fn test_is_team_eligible() {
        let team_on_field = Team {
            owner: Pubkey::new_unique(),
            player_ids: vec![1, 2, 3, 4, 5],
            category: TeamPackage::A,
            created_at: 0,
            nft_mint: Pubkey::default(),
            state: TeamState::OnField,
            team_id: 1,
        };
        
        let team_free = Team {
            owner: Pubkey::new_unique(),
            player_ids: vec![1, 2, 3, 4, 5],
            category: TeamPackage::A,
            created_at: 0,
            nft_mint: Pubkey::default(),
            state: TeamState::Free,
            team_id: 2,
        };
        
        // Team on field with player 3 should be eligible
        assert!(is_team_eligible(&team_on_field, 3));
        
        // Team on field without player 6 should not be eligible
        assert!(!is_team_eligible(&team_on_field, 6));
        
        // Team not on field should not be eligible even with player
        assert!(!is_team_eligible(&team_free, 3));
    }
}
