var RtmClient = require('@slack/client').RtmClient;
var RTM_EVENTS = require('@slack/client').RTM_EVENTS;
var CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS;
var WebClient = require('@slack/client').WebClient;
var axios = require('axios');
// var gapi = require('gapi');

/**
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

  console.log(`Logged in as ${rtmStartData.self.name} of team ${rtmStartData.team.name}, but not yet connected to a channel`);
})

// rtm.on(CLIENT_EVENTS.RTM.RTM_CONNECTION_OPENED, function () {
//   rtm.sendMessage("SchedulerBot at your service!", channel);
// });

rtm.on(RTM_EVENTS.MESSAGE, function handleRtmMessage(message) {
  console.log('USER', message.user);
  if (!message.subtype) {
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
    })
    .then(function (response) {
      console.log('RESPONSE', response.data.result);
      if (!response.data.result.actionIncomplete && Object.keys(response.data.result.parameters).length !== 0) {

        var interactive = {
          text: response.data.result.fulfillment.speech,
          attachments: [
            {
              text: `Is this correct <@${message.user}>?`,
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
      } else {
        var interactive = {
          text: response.data.result.fulfillment.speech,
        };
      }
      web.chat.postMessage(message.channel, response.data.result.fulfillment.speech, interactive, function(err, res) {
        if (err) {
          console.log('Error:', err);
        } else {
          console.log('Message sent interactive: ', res);
        }
      })
    })
    .catch(function (error) {
      console.log(error);
    });
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
