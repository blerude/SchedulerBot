var app = require('./app')
var models = require('./models');
var User = models.User;
var Reminder = models.Reminder;

var currDay = new Date();
var year =  currDay.getFullYear();
var today = currDay.getDate();
var tomorrow = currDay.getDate() + 1;
//case of last day of month 31+1=32
var month = today.getMonth();
var todayFind = `${year}-${month}-${today}`
var tomorrowFind = `${year}-${month}-${tomorrow}`
Reminder.findBy({date:todayFind})
.populate('User')
.exec(function(err,reminder){
  //im guessing we do something with
  reminder.user.slackId
})
Reminder.findBy({date:tomorrowFind})
.populate('User')
.exec(function(err,reminder){

})
module.exports = cronjob;
