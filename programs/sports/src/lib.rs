use anchor_lang::prelude::*;

declare_id!("5BqZmNdV2dgBEJ4aoid1LrKzXtJJR1fLskKUzygynDU9");

#[program]
pub mod sports {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
