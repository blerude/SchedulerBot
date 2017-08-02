var express = require('express');
var router = express.Router();
var models = require('../models');
var User = models.User;
var Reminder = models.Reminder;
var Meeting = models.Meeting;
var google = require('googleapis');
var OAuth2 = google.auth.OAuth2;
var axios = require('axios');

//////////////////////////////// PUBLIC ROUTES ////////////////////////////////
// Users who are not logged in can see these routes

var oauth2Client = new OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/googleauth/callback'
);

var addEvent = (subject, invitees, start, end) => {
  var attendees = [];
  console.log('INPUT', invitees);
  var emailsPromise = invitees.map(username => {
    console.log('USERNAME', username);
    return User.findOne({ slackRealName: username }).exec()
  })
  Promise.all(emailsPromise)
    .then(users => {
      users.forEach(user => {
        console.log('FOUND USER', user.slackEmail);
        attendees.push({ email: user.slackEmail });
      })
      console.log('ATTENDEES EMAIl', attendees);

      var event = {
        summary: subject,
        // location: '800 Howard St., San Francisco, CA 94103',
        // description: 'A chance to hear more about Google\'s developer products.',
        start: {
          dateTime: new Date(start)
          // timeZone: 'America/New_York'
        },
        end: {
          dateTime: new Date(end)
          // timeZone: 'America/New_York'
        },
        attendees: attendees
      };

      var calendar = google.calendar('v3');
      calendar.events.insert({
        auth: oauth2Client,
        calendarId: 'primary',
        resource: event,
      }, function(err, e) {
        if (err) {
          console.log('ERROR', err);
          return;
        }
        console.log('Event created: %s', e.htmlLink);
      });

    })
    .catch(err => {
      console.log('ERROR', err);
    })
  }


google.options({
  auth: oauth2Client
});

router.get('/googleoauth', (req, res) => {
  console.log('ID', process.env.GOOGLE_CLIENT_ID);
  var url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/plus.me'
    ],
    state: encodeURIComponent(JSON.stringify({
      auth_id: req.query.auth_id,
      subject: req.query.subject || 'Meeting',
      date: req.query.date,
      time: req.query.time,
      invitees: req.query.invitees
    }))
  });
  console.log('URL', url);
  res.redirect(url);
})

router.get('/googleauth/callback', (req, res) => {
  // console.log('AFTER FUNCTION', JSON.parse(decodeURIComponent(req.query.state)));

  if (!req.query.state) {
    console.log('BEFORE PARSE', req.query.tokens);
    console.log('AUTHORIZED', JSON.parse(req.query.tokens));
    oauth2Client.setCredentials(JSON.parse(req.query.tokens));
    if (req.query.time) {
      startDate = new Date(req.query.date + 'T' + req.query.time + '-07:00').getTime();
      endDate = startDate + (30 * 60 * 1000);
    } else {
      startDate = new Date(req.query.date + 'T00:00:00-07:00').getTime();
      endDate = startDate + (24 * 60 * 60 * 1000);
    }
    var sub = req.query.subject || 'Meeting';
    var invitees = req.query.invitees.split('_').map(sb => sb.split('0').join(' '));
    addEvent(sub, invitees, startDate, endDate);
    res.send('Event added!');
  } else {
    console.log('NOTAUTHORIZED', JSON.parse(decodeURIComponent(req.query.state)));
    oauth2Client.getToken(req.query.code, (err, tokens) => {
      // tokens contains an access_token and an optional refresh_token
      if (!err) {
        console.log('TOKEN', tokens);
        oauth2Client.setCredentials(tokens);
        User.findOne({ slackId: JSON.parse(decodeURIComponent(req.query.state)).auth_id })
          .then(user => {
            console.log('FOUND USER!', user);
            user.tokens = tokens;
            user.save()
              .then(user => {
                console.log('SAVED', user);
                var state = JSON.parse(decodeURIComponent(req.query.state));
                var startDate;
                var endDate;
                if (state.time !== undefined) {
                  startDate = new Date(state.date + 'T' + state.time + '-07:00').getTime();
                  endDate = startDate + (30 * 60 * 1000);
                } else {
                  startDate = new Date(state.date + 'T00:00:00-07:00').getTime();
                  endDate = startDate + (24 * 60 * 60 * 1000);
                }
                var invitees = state.invitees.split('_').map(sb => sb.split('0').join(' '));
                addEvent(state.subject, invitees, startDate, endDate);
              })
          })
          .catch(err => {
            console.log('ERROR', err);
          })
        }
    });
    res.redirect('https://calendar.google.com/calendar');
  }
})

router.post('/interactive', (req, res) => {
  console.log('IN INTERACTIVE');
  var string = JSON.parse(req.body.payload);
  User.findOne({slackId: string.user.id}, function(err, messager) {
    if (string.actions[0].value === 'cancel') {
      console.log('CANCELLED!')
      res.send('Scheduler cancelled');
    } else {
      var pending = JSON.parse(messager.pending)
      console.log('saving...')
      if (pending.invitee) {
        console.log('...a meeting')
        new Meeting({
          subject: pending.subject,
          date: pending.date,
          time: pending.time,
          invitees: pending.invitee,
          location: '',
          length: '',
          created: '',
          user: messager._id,
          channel: messager.channel
        }).save(function(err, savedMeeting) {
          if (err) {
            console.log(err)
          } else {
            console.log('CONFIRMED MEETING', savedMeeting);
            var formatSubject = pending.subject.split(' ').join('_')
            var stringInvitees = pending.invitee.map(inv => {
              return inv.split(' ').join('0')
            })
            console.log('invitee string' + stringInvitees)
            var formatInvitees = stringInvitees.join('_')
            if (messager.tokens && messager.tokens.expiry_date > new Date().getTime()) {
              res.redirect(`/googleauth/callback?subject=${formatSubject}&date=${pending.date}&time=${pending.time}&invitees=${formatInvitees}&tokens=${JSON.stringify(messager.tokens)}`);
            } else {
              res.send(`http://localhost:3000/googleoauth?auth_id=${string.user.id}&subject=${formatSubject}&date=${pending.date}&time=${pending.time}&invitees=${formatInvitees}`);
            }
          }
        })
      } else {
        console.log('...a reminder')
        new Reminder({
          subject: pending.subject,
          date: pending.date,
          user: messager._id,
          channel: messager.channel
        }).save(function(err) {
          console.log('CONFIRMED REMINDER', pending);
          var formatSubject = pending.subject.split(' ').join('_');
          if (messager.tokens && messager.tokens.expiry_date > new Date().getTime()) {
            res.redirect(`/googleauth/callback?subject=${formatSubject}&date=${pending.date}&tokens=${JSON.stringify(messager.tokens)}`);
            //res.send(200);
          } else {
            res.send(`http://localhost:3000/googleoauth?auth_id=${string.user.id}&subject=${formatSubject}&date=${pending.date}`);
          }
        })
      }
    }
    messager.pending = '';
    messager.save();
  })
})

module.exports = router;
