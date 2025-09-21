const crypto = require('crypto');

// Función para calcular discriminator de Anchor
function getDiscriminator(namespace, name) {
    const preimage = `${namespace}:${name}`;
    const hash = crypto.createHash('sha256').update(preimage).digest();
    return Array.from(hash.slice(0, 8));
}

// Calcular discriminator para buy_team
const buyTeamDiscriminator = getDiscriminator('global', 'buy_team');
console.log('buy_team discriminator:', buyTeamDiscriminator);
console.log('buy_team discriminator (hex):', Buffer.from(buyTeamDiscriminator).toString('hex'));

// Otros discriminators útiles
const initializeDiscriminator = getDiscriminator('global', 'initialize');
console.log('initialize discriminator:', initializeDiscriminator);

const stakeTeamDiscriminator = getDiscriminator('global', 'stake_team');
console.log('stake_team discriminator:', stakeTeamDiscriminator);

const refreshTeamStatusDiscriminator = getDiscriminator('global', 'refresh_team_status');
console.log('refresh_team_status discriminator:', refreshTeamStatusDiscriminator);
console.log('refresh_team_status discriminator (hex):', Buffer.from(refreshTeamStatusDiscriminator).toString('hex'));

const withdrawTeamDiscriminator = getDiscriminator('global', 'withdraw_team');
console.log('withdraw_team discriminator:', withdrawTeamDiscriminator);
console.log('withdraw_team discriminator (hex):', Buffer.from(withdrawTeamDiscriminator).toString('hex'));

// Calcular discriminator para el tipo de cuenta Team
const teamAccountDiscriminator = getDiscriminator('account', 'Team');
console.log("Team account discriminator:", Array.from(teamAccountDiscriminator));
console.log("Team account discriminator (hex):", Buffer.from(teamAccountDiscriminator).toString('hex'));
