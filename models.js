var mongoose = require('mongoose');

var userSchema = mongoose.Schema({
  googleCalendatAccount: Object,
  defaultMeetingMinutes: Number,
  slackId: String,
  slackUsername: String,
  slackEmail: String,
  slackDMIds: Array,
  tokens: Object
});



User = mongoose.model('User', userSchema);

module.exports = {
    User: User
};
