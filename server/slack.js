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

// Find all pending meetings
function checkPendingMeeting() {
  var now = new Date().getTime() - 7*60*60*1000;
  Meeting.find({created: false }, function(err, meetings) {
    if (err) console.log('Error finding meetings within CheckPendingMeeting', err);
    else {
      // Iterate through meetings
      meetings.forEach(meeting => {
        var allAuthorized = true;

        // Find all participants of a given meeting in order to check authorization
        var meetingPromise = meeting.invitees.map(inv => {
          return User.findOne({slackId: inv.slice(2) }).exec()
        })
        Promise.all(meetingPromise)
        .then(result => {
          var clipInvitees = [];
          result.forEach(invite => {
            clipInvitees.push('@' + invite.slackUsername);
            if (!(invite.tokens && invite.tokens.expiry_date > new Date().getTime() - 7*60*60*1000)) {
              allAuthorized = false;
            }
          })
          var inviteesStr = clipInvitees.join(', ');


          // Check first if the meeting is within the next two hours
          if (now - meeting.createdAt < 30*1000) { // TEST
          // if (now - meeting.createdAt < 2*60*60*1000) {
            // If all are authorized, notify that meeting can be scheduled
            if (allAuthorized) {
              web.chat.postMessage(meeting.channel, `You can now initialize your meeting to ${meeting.subject} at ${meeting.date}, ${meeting.time} with ${inviteesStr}`, function(err, res) {
                if (err) {
                  console.log('Error posting all-auth message', err);
                } else {
                  // Update meeting's status
                  meeting.created = true;
                  meeting.save();
                }
              })
            }
          } else { // If meeting has expired
            if (meeting.cancelIn2Hours && !allAuthorized) {
              meeting.remove();
            } else {
              web.chat.postMessage(meeting.channel, `You are free to initialize your meeting to ${meeting.subject} at ${meeting.date}, ${meeting.time} with ${inviteesStr}`, function(err, res) {
                if (err) {
                  console.log('Error posting two-hour auth message', err);
                } else {
                  // Update meeting's status
                  meeting.created = true;
                  meeting.save();
                }
              })
            }
          }
        }).catch(err => {console.log('Error finding meeting participants', err)});
      })
    }
  })
}

// The client will emit an RTM.AUTHENTICATED event on successful connection, with the `rtm.start` payload
rtm.on(CLIENT_EVENTS.RTM.AUTHENTICATED, (rtmStartData) => {
  for (const c of rtmStartData.channels) {
    if (c.name === 'general') { channel = c.id }
  }

  // Set user's log-in tokens
  User.find({}, function(err, users) {
    users.forEach(user => {
      if (!user.tokens || (user.tokens && user.tokens.expiry_date < new Date().getTime())) {
        user.tokens = {};
        user.save();
      }
    })
  })

  // Check for pending meetings every two minutes
  setInterval(checkPendingMeeting, 10*1000); // TEST
  // setInterval(checkPendingMeeting, 5*60*1000);

  // Send reminders for events within the next two days
  var today = new Date().getTime();
  var tomorrow = today + (1000 * 60 * 60 * 24);
  var nextDay = tomorrow + (1000 * 60 * 60 * 24);
  Reminder.find({}, function(err, reminders) {
    if (err) {
      console.log('Error finding reminders to send', err)
    } else {
      reminders.forEach(rem => {
        var adjTime = new Date(rem.date).getTime() + (1000 * 60 * 60 * 7)
        if (adjTime > today && adjTime < tomorrow) {
          var msg = 'Reminder: You have to ' + rem.subject + ' in the next 24 hours!';
          web.chat.postMessage(rem.channel, msg)
          rem.remove()
        } else if (adjTime > tomorrow && adjTime < nextDay) {
          var msg = 'Reminder: You have to ' + rem.subject + ' in one day!';
          web.chat.postMessage(rem.channel, msg)
        }
      })
    }
  })

  // Find all users, and if any are unlogged, create a user in the database for them
  var users = rtmStartData.users;
  users.forEach(user => {
    User.findOne({slackId: user.id}, function(err, foundUser) {
      if (err) {
        console.log("Error initially finding all users", err)
      } else if (!foundUser) {
        new User({
          googleCalendarAccount: {},
          slackId: user.id,
          slackRealName: user.real_name || '',
          slackEmail: user.profile.email || '',
          slackUsername: user.name,
          pending: ''
        }).save(function(err, savedUser) {
          if (err) {
            res.send("Error saving new users upon connecting", err)
          }
        })
      }
    })
  })
  console.log(`Logged in as ${rtmStartData.self.name} of team ${rtmStartData.team.name}, but not yet connected to a channel`);
})

// Function for checking user's calendars for scheduled events
//  Returns a promise of all user's events
function checkFreeBusy(slackId) {
  return new Promise(function(resolve, reject) {
    var start = (new Date()).getTime();
    var end = start + 1000 * 60 * 60 * 24 * 7;
    var calendar = google.calendar('v3');
    // Find all users
    User.findOne({ slackId: slackId }, function(err, user) {
      if (err) {
        reject(err);
        return;
      }
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
          reject(err);
          return;
        }
        var events = response.items;
        if (events.length === 0) { // Empty schedule
          resolve([]);
        } else {  // Events found
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

// Sending messages
rtm.on(RTM_EVENTS.MESSAGE, function handleRtmMessage(message) {
  if (!message.subtype) { // If the message is sent from a user, not the scheduler bot
    // Find the user who sent the message
    User.findOne({slackId: message.user}, function(err, sentUser) {
      // If the user has pending queries
      if (sentUser.pending) {
        web.chat.postMessage(message.channel, 'You have unresolved queries!')
      } else { // User is free to initiate a new query
        // Post the user's message
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
        }).then(response => {   // Yield response of message axios post
          // If the action is complete and the message contains parameters, continue
          if (!response.data.result.actionIncomplete && Object.keys(response.data.result.parameters).length !== 0) {
            // If adding a reminder
            if (response.data.result.action === 'addReminder') {
              // Set user's pending to the message params
              sentUser.pending = JSON.stringify({
                subject: response.data.result.parameters.subject,
                date: response.data.result.parameters.date,
              });
              sentUser.channel = message.channel
              // Save the user
              sentUser.save((err, sentUser) => {
                if (err) {
                  console.log('Error saving user while setting reminder', err)
                } else {
                  // Create interactive message
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
                  web.chat.postMessage(message.channel, response.data.result.fulfillment.speech, interactive);
                }
              })
            } else if (response.data.result.action === 'addMeeting') { // Schedule a meeting
              // Set the parameters to the content of the meeting scheduler message
              sentUser.pending = JSON.stringify({
                subject: response.data.result.parameters.subject,
                date: response.data.result.parameters.date,
                invitee: response.data.result.parameters.invitee,
                time: response.data.result.parameters.time
              });
              sentUser.save((err, sentUser) => {
                if (err) {
                  console.log("Error saving user while setting meetign pending string", err)
                } else {
                  // Find all invitees for prospective meeting
                  var params = response.data.result.parameters;
                  var invitees = params.invitee;
                  var invitees = invitees.map(inv => {
                    return inv.split('@')[1];
                  })
                  var members = invitees;
                  members.push(sentUser.slackId)

                  // If the user is not authorized, send a link to authorize
                  if (!(sentUser.tokens  && sentUser.tokens.expiry_date > new Date().getTime())) {
                    web.chat.postMessage(message.channel, `Oops! You need to authorize your Google Calendar first: http://localhost:3000/googleoauth?auth_id=${sentUser.slackId}&subject=${params.subject.split(' ').join('_')}&date=${params.date[0]}&time=${params.time[0]}&invitees=${params.invitee}`, function(err, res) {
                      if (err) {
                        console.log('Error authorizing user', err);
                      }
                    })
                  }
                  // Create an array of promises containing the users that are included in the meeting
                  var notAuthorized = [];
                  var membersPromise = members.map(m => {
                    return User.findOne({slackId: m}).exec();
                  })
                  // Once all members have been returned, check for unauthorized
                  Promise.all(membersPromise)
                  .then(members => {
                    members.forEach(member => {
                      if (!(member.tokens  && member.tokens.expiry_date > new Date().getTime())) {
                        notAuthorized.push(member);
                      }
                    })

                    // If there are unauthorized attendees
                    if (notAuthorized.length !== 0) {
                      // If the meeting is within four hours, inform the user that there is not enough time to get permission
                      if (new Date(params.date + 'T' + params.time).getTime() - (new Date().getTime()-7*60*60*1000) < 4*60*60*1000) {
                        web.chat.postMessage(message.channel, "Cannot schedule, too soon!", function(err, res) {
                          if (err) {
                            console.log("Error sending 'meeting too soon' warning", err);
                          }
                        })
                      } else { // If there is enough time...
                        // Create interactive message
                        var prompt = {
                          text: 'PROMPT',
                          attachments: [
                            {
                              text: "Don't have access to all invitees - send request?",
                              fallback: "You could not confirm your meeting",
                              callback_id: "meeting",
                              color: "#3AA3E3",
                              attachment_type: "default",
                              actions: [
                                {
                                  name: "confim",
                                  text: "Yes",
                                  type: "button",
                                  value: "sendRequest"
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
                        web.chat.postMessage(message.channel, "Request Confirmation", prompt, function(err, res) {
                          if (err) {
                            console.log('Error sending message asking for permission to request GCal access from attendees', err);
                          }
                        })
                      }
                    }
                    return null
                  })
                  // Continue with the chain to find the scheduled events of each invitee
                  .then(dummyReturns => {
                    var conflictsPromise = members.map(member => {
                      if (member) return checkFreeBusy(member);
                    })
                    return Promise.all(conflictsPromise)
                  })
                  .then(returns => {
                    // Gather all events across all participants into one array
                    var events = returns.reduce((a, b) => {
                      return a.concat(b)
                    })

                    // Eliminate undefined events
                    eventsCopy = []
                    events.forEach(ev => {
                      if (ev) eventsCopy.push(ev)
                    })
                    events = eventsCopy;

                    // Check for conflicts
                    var newStart = new Date(response.data.result.parameters.date + 'T' + response.data.result.parameters.time + '-07:00').getTime();
                    var newEnd = newStart + 1000 * 60 * 30

                    var conflict = false;
                    events.forEach(event => {
                      // If a conflict is found, change the flag
                      if ((newStart >= new Date(event.start).getTime() && newStart <= new Date(event.end).getTime()) ||
                      (newEnd >= new Date(event.start).getTime() && newEnd <= new Date(event.end).getTime())) {
                        conflict = true;
                      }
                    })

                    // Find all the users
                    var invPromises = invitees.map(inv => {
                      return User.findOne({ slackId: inv }).exec()
                    })
                    return Promise.all(invPromises)
                    // Push the users onto the pending invitees array
                    .then(returnValue => {
                      var pendingInvitees = [];
                      returnValue.forEach(val => {
                        if (!val) {
                          console.log("User not found; can't invite them.")
                        } else {
                          pendingInvitees.push(val.slackRealName)
                        }
                      })

                      sentUser.pending = JSON.stringify({
                        subject: response.data.result.parameters.subject,
                        date: response.data.result.parameters.date,
                        invitee: pendingInvitees.slice(0, pendingInvitees.length - 1),
                        time: response.data.result.parameters.time
                      });
                      sentUser.channel = message.channel
                      sentUser.save((err, sentUser) => {
                        if (err) {
                          console.log("Error saving user before interactive message", err)
                        } else {
                          // If a conflict was found
                          if (conflict) {
                            var aDay = 86400000;
                            var now = new Date().getTime();
                            var nextMidnight = now - now%aDay;
                            var halfHour = aDay/48;
                            var available = [];
                            var count = 0;

                            // Find 10 slots over the next week (no more than 3 per day) for which there is no time conflict
                            while (count < 10) {
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
                            }

                            // Send an interactive message with a dropdown of options to reschedule
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
                            web.chat.postMessage(message.channel, "Time conflict!", dropDown)
                          } else {
                            // No conflicts!
                            var parseList = JSON.parse(sentUser.pending).invitee
                            var inviteeList = parseList.join(', ')
                            if (response.data.result.parameters.subject){
                              var text = `Meeting with ${inviteeList} to ${response.data.result.parameters.subject} on ${response.data.result.parameters.date} at ${response.data.result.parameters.time}, correct?`
                            } else {
                              var text = `Meeting with ${inviteeList} on ${response.data.result.parameters.date} at ${response.data.result.parameters.time}, correct?`
                            }

                            // Send interactive message with confirmation details
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
                            web.chat.postMessage(message.channel, response.data.result.fulfillment.speech, interactive)
                          }
                        }
                      })
                    }).catch(err => {
                      console.log("Invitee promise chain err", err)
                    })
                  })
                  .catch(err => {
                    console.log('Event promise chain err', err)
                  })
                }
              })
            }
          } else { // If action is not complete, send a normal message
            var interactive = {
              text: response.data.result.fulfillment.speech,
            };
            web.chat.postMessage(message.channel, response.data.result.fulfillment.speech)
          }
        })
      }
    })
  }
});

module.exports = {
  rtm,
  web
};
