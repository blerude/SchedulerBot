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

var reminderSchema =  mongoose.Schema({
  subject: String,
  date: String,
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
})

User = mongoose.model('User', userSchema);
Reminder = mongoose.model('Reminder', reminderSchema);

module.exports = {
  User: User,
  Reminder:Reminder
};
