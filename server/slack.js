var RtmClient = require('@slack/client').RtmClient;
var RTM_EVENTS = require('@slack/client').RTM_EVENTS;
var CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS;
var WebClient = require('@slack/client').WebClient;
var axios = require('axios')
var User = require('../models.js').User;
var Reminder = require('../models.js').Reminder;

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
  var users = rtmStartData.users;
  users.forEach(user => {
    User.findOne({slackId: user.id}, function(err, foundUser) {
      if (err) {
        console.log(err)
      } else if (!foundUser) {
        new User({
          googleCalendarAccount: {},
          slackId: user.id,
          slackUsername: user.name,
          pending: ''
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
// rtm.on(CLIENT_EVENTS.RTM.RTM_CONNECTION_OPENED, function () {
//   rtm.sendMessage("SchedulerBot at your service!", channel);
// });
rtm.on(RTM_EVENTS.MESSAGE, function handleRtmMessage(message) {
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
            // context: [{
            //     name: "weather",
            //     lifespan: 4
            // }],
            // location: {
            //     latitude: 37.459157,
            //     longitude: -122.17926
            // },
            // timezone: "America/New_York",
            lang: "en",
            sessionId: message.user
          }
        }).then(response => {
          // console.log('response', response)
          if (!response.data.result.actionIncomplete && Object.keys(response.data.result.parameters).length !== 0) {
            User.findOne({ slackId: message.user }, function(err, foundUser) {
              if (err) {
                console.log(err)
              } else if (!foundUser.pending) {
                foundUser.pending = JSON.stringify({
                  subject: response.data.result.parameters.subject,
                  date: response.data.result.parameters.date
                });
              } 
              foundUser.save()
              .then(resp2 => {
                // console.log('response2: ', resp2)
                var interactive = {
                  text: response.data.result.fulfillment.speech,
                  attachments: [
                    {
                      text: "Reminder to " +
                        response.data.result.parameters.subject +
                        " on " + response.data.result.parameters.date +
                        ", correct?",
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
          } else {
            var interactive = {
              text: response.data.result.fulfillment.speech,
            };
            web.chat.postMessage(message.channel, response.data.result.fulfillment.speech, interactive, function(err, res) {
              // if (err) {
              //   console.log('Error:', err);
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
// rtm.on(RTM_EVENTS.REACTION_ADDED, function handleRtmReactionAdded(reaction) {
//   console.log('Reaction added:', reaction);
// });
// rtm.on(RTM_EVENTS.REACTION_REMOVED, function handleRtmReactionRemoved(reaction) {
//   console.log('Reaction removed:', reaction);
// });
module.exports = {
  rtm,
  web
};
