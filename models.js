var mongoose = require('mongoose');

var userSchema = mongoose.Schema({
  googleCalendarAccount: Object,
  defaultMeetingMinutes: Number,
  slackId: String,
  slackUsername: String,
  slackEmail: String,
  slackDMIds: Array,
  tokens: Object,
  pending: String
});

User = mongoose.model('User', userSchema);

module.exports = {
    User: User
};
