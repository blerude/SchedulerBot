var RtmClient = require('@slack/client').RtmClient;
var RTM_EVENTS = require('@slack/client').RTM_EVENTS;
var CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS;
var WebClient = require('@slack/client').WebClient;

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

  web.chat.postMessage(channel, 'Hello there', function(err, res) {
    if (err) {
      console.log('Error:', err);
    } else {
      console.log('Message sent interactive: ', res);
    }
  })

  console.log(`Logged in as ${rtmStartData.self.name} of team ${rtmStartData.team.name}, but not yet connected to a channel`);
})

rtm.on(CLIENT_EVENTS.RTM.RTM_CONNECTION_OPENED, function () {
  rtm.sendMessage("SchedulerBot at your service!", channel);
});

rtm.on(RTM_EVENTS.MESSAGE, function handleRtmMessage(message) {
  console.log('message', message)
  rtm.sendMessage(message.text, message.channel);
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
