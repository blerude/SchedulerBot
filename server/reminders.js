var express = require('express');
var router = express.Router();
var Reminder = require('../models.js').Reminder;
var web = require('./slack.js').web;
// router.get('/grab', (req, res) => {
var sendReminders = () => {
  console.log('sending')
  var today = new Date().getTime();
  var tomorrow = today + (1000 * 60 * 60 * 24);
  var nextDay = tomorrow + (1000 * 60 * 60 * 24);
  Reminder.find({}, function(err, reminders) {
    reminders.forEach(rem => {
      if (new Date(rem.date).getTime() > today && new Date(rem.date).getTime() < tomorrow) {
        var msg = 'Reminder: You have to ' + rem.subject + ' in the next 24 hours!';
        web.chat.postMessage(rem.channel, msg)
        rem.remove()
      } else if (new Date(rem.date).getTime() > tomorrow && new Date(rem.date).getTime() < nextDay) {
        var msg = 'Reminder: You have to ' + rem.subject + ' in one day!';
        web.chat.postMessage(rem.channel, msg)
      }
    })
  })
}
sendReminders();
module.exports = sendReminders
