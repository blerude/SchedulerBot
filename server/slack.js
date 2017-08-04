var RtmClient = require('@slack/client').RtmClient;
var RTM_EVENTS = require('@slack/client').RTM_EVENTS;
var CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS;
var WebClient = require('@slack/client').WebClient;
var axios = require('axios')
var User = require('../models.js').User;
var Reminder = require('../models.js').Reminder;
var Meeting = require('../models.js').Meeting;
var oauth2Client = require('../routes/routes.js').oauth2Client;
var google = require('googleapis');
var _ = require('underscore')

/*
* Example for creating and working with the Slack RTM API.
*/
/* eslint no-console:0 */
var rtmToken = process.env.SLACK_API_TOKEN || '';
var webToken = process.env.SLACK_API_TOKEN || ''; //see section above on sensitive data
var rtm = new RtmClient(rtmToken);
var web = new WebClient(webToken);
let channel;
// The client will emit an RTM.AUTHENTICATED event on successful connection, with the `rtm.start` payload
rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, (rtmStartData) => {
  for (const c of rtmStartData.channels) {
    if (c.name === 'general') { channel = c.id }
  }

  User.find({}, function(err, users) {
    console.log('SET TOKEN');
    users.forEach(user => {
      if (!user.tokens || (user.tokens && user.tokens.expiry_date < new Date().getTime())) {
        user.tokens = {};
        user.save();
      }
    })
  })

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

  var users = rtmStartData.users;
  users.forEach(user => {
    User.findOne({slackId: user.id}, function(err, foundUser) {
      if (err) {
        console.log(err)
      } else if (!foundUser) {
        new User({
          googleCalendarAccount: {},
          slackId: user.id,
          slackRealName: user.real_name || '',
          slackEmail: user.profile.email || '',
          slackUsername: user.name,
          pending: '',
          // channel:
        }).save(function(err, savedUser) {
          if (err) {
            res.send(err)
          } else {
            console.log('User saved')
          }
        })
      }
    })
  })
  console.log(`Logged in as ${rtmStartData.self.name} of team ${rtmStartData.team.name}, but not yet connected to a channel`);
})

function checkFreeBusy(slackId) {
  return new Promise(function(resolve, reject) {
    console.log('IN CHECKFREEBUSY', oauth2Client, slackId);
    var start = (new Date()).getTime();
    var end = start + 1000 * 60 * 60 * 24 * 7;
    var calendar = google.calendar('v3');
    User.findOne({ slackId: slackId }, function(err, user) {
      if (err) {
        reject(err);
        return;
      }
      console.log('user', user)
      oauth2Client.setCredentials(user.tokens);
      calendar.events.list({
        auth: oauth2Client,
        calendarId: user.slackEmail,
        timeMin: new Date(start).toISOString(),
        timeMax: new Date(end).toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: 'startTime'
      }, function(err, response) {
        if (err) {
          console.log('ERROR', err);
          reject(err);
          return;
        }
        var events = response.items;
        if (events.length === 0) {
          return null;
        } else {
          var res = [];
          for (var i = 0; i < events.length; i++) {
            var event = events[i];
            var start = event.start.dateTime || event.start.date;
            var end = event.end.dateTime || event.end.date;
            res.push({ start: start, end: end, user: event.organizer });
          }
          resolve(res);
        }
      });
    })
  })

}

rtm.on(RTM_EVENTS.MESSAGE, function handleRtmMessage(message) {
  console.log('USER', message.user, message);
  if (!message.subtype) {
    console.log('MESSAGE', message);
    User.findOne({slackId: message.user}, function(err, sentUser) {
      console.log('user: ', sentUser)
      if (sentUser.pending) {
        web.chat.postMessage(message.channel, 'You have unresolved queries!', function(err, res) {
          // if (err) {
          //   console.log('Error:', err);
          // } else {
          //   console.log('Message denied.');
          // }
        })
        // } else if (!sentUser.googleCalendarAccount) {
        //   console.log("authorization")
      } else {
        axios({
          method: 'post',
          url: 'https://api.api.ai/v1/query?v=20150910',
          headers: {
            "Authorization": "Bearer a53d802617124f92b9a6d63c76dd2d08",
            "Content-Type": "application/json; charset=utf-8"
          },
          data: {
            query: message.text,
            lang: "en",
            sessionId: message.user
          }
        }).then(response => {
          if (!response.data.result.actionIncomplete && Object.keys(response.data.result.parameters).length !== 0) {
            if (response.data.result.action === 'addReminder') {
              User.findOne({ slackId: message.user }, function(err, foundUser) {
                if (err) {
                  console.log(err)
                } else if (!foundUser.pending) {
                  foundUser.pending = JSON.stringify({
                    subject: response.data.result.parameters.subject,
                    date: response.data.result.parameters.date,
                  });
                  foundUser.channel = message.channel
                }
                foundUser.save()
                .then(resp2 => {
                  var interactive = {
                    text: response.data.result.fulfillment.speech,
                    attachments: [
                      {
                        text: "Reminder to " + response.data.result.parameters.subject + " on " + response.data.result.parameters.date + ", correct?",
                        fallback: "You could not confirm your meeting",
                        callback_id: "wopr_game",
                        color: "#3AA3E3",
                        attachment_type: "default",
                        actions: [
                          {
                            name: "confim",
                            text: "Yes",
                            type: "button",
                            value: "yes"
                          },
                          {
                            name: "confirm",
                            text: "Cancel",
                            type: "button",
                            value: "cancel"
                          }
                        ]
                      }
                    ]
                  }
                  web.chat.postMessage(message.channel, response.data.result.fulfillment.speech, interactive, function(err, res) {
                    // if (err) {
                    //   console.log('Error:', err);
                    // } else {
                    //   console.log('Message sent interactive: ', res);
                    // }
                  })
                }).catch(function (error) {
                  console.log('uh oh' + error);
                });
              })
            } else if (response.data.result.action === 'addMeeting') {

              // RUN MEETING AVAILABILITY CHECK
              var params = response.data.result.parameters;
              var invitees = params.invitee;
              console.log('PARAMS', params);
              var invitees = invitees.map(inv => {
                return inv.split('@')[1];
              })
              var members = invitees;
              User.findOne({ slackId: message.user }, function(err, foundUser) {
                if (err) {
                  console.log(err)
                }
              }).then(resp => {
                members.push(resp.slackId)
                console.log('members', members)

                if (!(resp.tokens  && resp.tokens.expiry_date > new Date().getTime())) {
                  web.chat.postMessage(message.channel, `http://localhost:3000/googleoauth?auth_id=${resp.slackId}&subject=${params.subject.split(' ').join('_')}&date=${params.date[0]}&time=${params.time[0]}&invitees=${params.invitee}`, function(err, res) {
                    if (err) {
                      console.log('ERROR', err);
                    } else {
                      console.log('AUTH SENT', res);
                    }
                  })
                }

                var conflictsPromise = members.map(member => {
                  console.log("WE'RE CHECKING " + member)
                  if (member) return checkFreeBusy(member);
                })
                return Promise.all(conflictsPromise)
              })
              .then(returns => {
                var events = returns.reduce((a, b) => {
                  console.log(a, b)
                  return a.concat(b)
                })

                console.log('EVENTS', events)
                eventss = []
                events.forEach(ev => {
                  if (ev) eventss.push(ev)
                })
                events = eventss;
                console.log('AFTER EVENTS', events)

                var newStart = new Date(response.data.result.parameters.date + 'T' + response.data.result.parameters.time + '-07:00').getTime();
                var newEnd = newStart + 1000 * 60 * 30

                var conflict = false;
                events.forEach(event => {
                  if ((newStart >= new Date(event.start).getTime() && newStart <= new Date(event.end).getTime()) ||
                  (newEnd >= new Date(event.start).getTime() && newEnd <= new Date(event.end).getTime())) {
                    console.log('FOUND A CONFLICT')
                    conflict = true;
                  }
                })

                var pendingInvitees = [];
                var invPromises = invitees.map(inv => {
                  return User.findOne({ slackId: inv })
                  .exec()
                })
                Promise.all(invPromises)
                .then(returnValue => {
                  returnValue.forEach(val => {
                    if (!val) {
                      console.log("User not found; can't invite them.")
                    } else {
                      pendingInvitees.push(val.slackRealName)
                    }
                  })

                  User.findOne({ slackId: message.user }, function(err, foundUser) {
                    if (err) {
                      console.log(err)
                    } else if (!foundUser.pending) {
                      foundUser.pending = JSON.stringify({
                        subject: response.data.result.parameters.subject,
                        date: response.data.result.parameters.date,
                        invitee: pendingInvitees.slice(0, pendingInvitees.length - 1),
                        time: response.data.result.parameters.time
                      });
                      foundUser.channel = message.channel
                    }
                    foundUser.save()
                    .then(resp2 => {

                      // CONFLICTS
                      if (conflict) {

                        console.log('CONFLICT!!! CHANGE TIME');
                        var aDay = 86400000;
                        var now = new Date().getTime();
                        var nextMidnight = now - now%aDay;
                        var halfHour = aDay/48;
                        var available = [];
                        var count = 0;

                        while( count < 10 ) {
                          var dayCount = 0;
                          nextMidnight += aDay;
                          var aDayTimes = [];
                          _.range(8,21).forEach(hour => {
                            aDayTimes.push({start: nextMidnight+hour*60*60*1000, end: nextMidnight+hour*60*60*1000+halfHour});
                            aDayTimes.push({start: nextMidnight+hour*60*60*1000+halfHour, end: nextMidnight+(hour+1)*60*60*1000});
                          })
                          while (dayCount < 3) {
                            for (var i in aDayTimes) {
                              var slot = aDayTimes[i];
                              for (var j in events) {
                                if (!((slot.start > new Date(events[j].start).getTime() && new Date(events[j].end).getTime()) || (slot.end > new Date(events[j].start).getTime() && slot.start < new Date(events[j].end).getTime()))) {
                                  if (dayCount < 3 && count < 10) {
                                    console.log('ONE MORE SLOT', new Date(slot.start));
                                    available.push(slot);
                                    dayCount++;
                                    count++;
                                    break;
                                  }
                                }
                              }
                              if (count === 10) dayCount = 3;
                            }
                          }
                          console.log('new day')
                        }

                        console.log('A DAY', available);
                        var options = [];
                        var options = [];
                        available.forEach(time => {
                        	options.push({
                        		text: new Date(time.start).toLocaleString('en-US', { timeZone: "UTC" }),
                        		value: new Date(time.start).toLocaleString('en-US', { timeZone: "UTC" })
                        	})
                        })
                        options.push({text: 'Cancel meeting', value: 'cancel'})
                        var dropDown = {
                          text: "When would you like to meet?",
                          response_type: "in_channel",
                          attachments: [{
                            text: "Choose another time^",
                            fallback: "Meeting cancelled.",
                            color: "#3AA3E3",
                            attachment_type: "default",
                            callback_id: "game_selection",
                            actions: [{
                              name: "time_list",
                              text: "Pick a time...",
                              type: "select",
                              options: options
                            }]
                          }]
                        }

                        web.chat.postMessage(message.channel, "Time conflict!", dropDown, function(err, res) {
                          if (err) {
                            console.log('ERROR', err);
                          } else {
                            console.log('DROPDOWN SENT', res);
                          }
                        })

                      } else {
                        var parseList = JSON.parse(resp2.pending).invitee
                        var inviteeList = parseList.join(', ')
                        if (response.data.result.parameters.subject){
                          var text = `Meeting with ${inviteeList} to ${response.data.result.parameters.subject} on ${response.data.result.parameters.date} at ${response.data.result.parameters.time}, correct?`
                        } else {
                          var text = `Meeting with ${inviteeList} on ${response.data.result.parameters.date} at ${response.data.result.parameters.time}, correct?`
                        }

                        var interactive = {
                          text: response.data.result.fulfillment.speech,
                          attachments: [
                            {
                              text: text,
                              fallback: "You could not confirm your meeting",
                              callback_id: "wopr_game",
                              color: "#3AA3E3",
                              attachment_type: "default",
                              actions: [
                                {
                                  name: "confim",
                                  text: "Yes",
                                  type: "button",
                                  value: "yes"
                                },
                                {
                                  name: "confirm",
                                  text: "Cancel",
                                  type: "button",
                                  value: "cancel"
                                }
                              ]
                            }
                          ]
                        }
                        web.chat.postMessage(message.channel, response.data.result.fulfillment.speech, interactive, function(err, res) {
                          // if (err) {
                          //   console.log('Error:', err);
                          // } else {
                          //   console.log('Message sent interactive: ', res);
                          // }
                        })
                      }


                      // }).catch(function (error) {
                      //   console.log('uh oh' + error);
                      // });
                    }).catch(function (error) {
                      console.log('uh oh' + error);
                    }); // end userFindOne
                  })
                })
              }).catch(function(err) {console.log('BAD! ', err)})
            }
          } else {
            var interactive = {
              text: response.data.result.fulfillment.speech,
            };
            web.chat.postMessage(message.channel, response.data.result.fulfillment.speech, interactive, function(err, res) {
              // if (err) {
              // console.log('Error:', err);
              // } else {
              //   console.log('Message sent interactive: ', res);
              // }
            })
          }
        })
        .catch(function (error) {
          console.log(error);
        });
      }
    })
  }
});

module.exports = {
  rtm,
  web
};
