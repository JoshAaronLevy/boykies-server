/**
 * Helper function to slim down player data for blocking API calls
 * Whitelists allowed fields, caps player count, and truncates strings
 */
function slimPlayers(players, opts = {}) {
  // Defensive: if players is not an array, return empty array
  if (!Array.isArray(players)) {
    return [];
  }

  // Get configuration from environment variables with defaults
  const allowedFieldsStr = process.env.PLAYER_ALLOWED_FIELDS || 'id,name,position,team,byeWeek,stats,previousOverallRank,previousPositionRank,newOverallRank,newPositionRank,adp';
  const maxPlayers = Number(process.env.MAX_INIT_PLAYERS || 50);
  const maxStringLen = Number(process.env.MAX_STRING_LEN || 200);

  // Parse allowed fields
  const allowedFields = allowedFieldsStr.split(',').map(field => field.trim()).filter(Boolean);

  // Cap the number of players
  const cappedPlayers = players.slice(0, maxPlayers);

  // Process each player
  return cappedPlayers.map(player => {
    if (!player || typeof player !== 'object') {
      return {};
    }

    const slimmedPlayer = {};

    // Only include allowed fields
    allowedFields.forEach(field => {
      if (player.hasOwnProperty(field)) {
        let value = player[field];

        // Truncate string fields to max length
        if (typeof value === 'string' && value.length > maxStringLen) {
          value = value.slice(0, maxStringLen);
        }

        slimmedPlayer[field] = value;
      }
    });

    return slimmedPlayer;
  });
}

module.exports = { slimPlayers };