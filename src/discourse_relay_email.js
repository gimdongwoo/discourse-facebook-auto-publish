import nodemailer from 'nodemailer';
import RestClient from './restClient';

let checkDate = new Date();
// for developemnt
if (process.env.NODE_ENV !== 'production') checkDate = checkDate.setHours(-24);

let lastPostDate = checkDate;

// get discourse cagegory
function getCategories(categoryId) {
  return new Promise((resolve, reject) => {
    const restClient = new RestClient();
    restClient.get(process.env.DISCOURSE_URL + '/site.json').then((results) => {
      if (results && typeof results !== 'object') results = JSON.parse(results);

      if (results && results.categories) {
        const findCategory = results.categories.find((category) => { return category.id === categoryId; });
        return resolve(findCategory);
      }
      console.error('categories.json scheme error');
      return reject('categories.json scheme error');
    }, reject);
  });
}

// email send
function emailSender(_subject, _html) {
  return new Promise((resolve, reject) => {
    // create reusable transporter object using the default SMTP transport
    const transport = nodemailer.createTransport({
      service: 'Gmail',
      auth: {
        user: process.env.GMAIL_ID,
        pass: process.env.GMAIL_PW
      }
    });

    // setup email data with unicode symbols
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      subject: _subject,
      html: _html
    };

    console.log('mailOptions', mailOptions);

    // for developemnt
    if (process.env.NODE_ENV !== 'production') return resolve();

    // send mail with defined transport object
    transport.sendMail(mailOptions, function (error, info) {
      if (error) {
        console.error(error);
        return reject(error);
      }
      console.log('Message %s sent: %s', info.messageId, info.response);
      return resolve();
    });
  });
}

// parse topics
function parseTopics(topics, users) {
  const postedOverMin = process.env.POSTED_AFTER_MIN * 1;

  // important - filtering
  const filteredTopics = topics.filter((info) => {
    const createdAt = new Date(info.created_at);
    // posted over 5 min
    const timeDiffMin = ((new Date()).getTime() - createdAt.getTime()) / (1000 * 60);
    // lastPostDate keep
    if (timeDiffMin > postedOverMin && createdAt > lastPostDate) lastPostDate = createdAt;
    // check new post
    return timeDiffMin > postedOverMin && createdAt > checkDate;
  });
  console.log('filteredTopics', JSON.stringify(filteredTopics));

  // promise serialize
  const p = Promise.resolve();
  return filteredTopics.reduce((pacc, info) => {
    const fn = function () {
      // get category
      return getCategories(info.category_id).then((categoryInfo) => {
        // subject
        const _subject = info.title;
        // find post user
        let _posters = null;
        if (info.posters.length === 1) {
          _posters = info.posters[0];
        } else {
          _posters = info.posters.find((poster) => {
            return poster.description.indexOf('원본 게시자') > -1;
          });
        }
        if (!_posters) _posters = info.posters[0];
        // users serach
        const _postUser = users.find((user) => {
          return user.id === _posters.user_id;
        });
        // body
        const _subjectNew = '[' + categoryInfo.name + '] ' + _subject;
        const _html = 'by @' + _postUser.username + '<br/>' + process.env.DISCOURSE_URL + '/t/' + info.slug + '/' + info.id;

        return emailSender(_subjectNew, _html);
      });
    };

    pacc = pacc.then(fn);
    return pacc;
  }, p);
}

// get discourse topics
function getDiscourse() {
  return new Promise((resolve, reject) => {
    const restClient = new RestClient();
    restClient.get(process.env.DISCOURSE_URL + '/latest.json').then((results) => {
      if (results && typeof results !== 'object') results = JSON.parse(results);

      if (results && results.topic_list && results.topic_list.topics) {
        return parseTopics(results.topic_list.topics, results.users).then(resolve, reject);
      }
      console.error('latest.json scheme error');
      return reject('latest.json scheme error');
    }, reject);
  });
}

// iterator
function iterator() {
  console.log('start, checkDate', checkDate);

  const nextRun = () => {
    checkDate = lastPostDate;
    console.log('success, checkDate update', checkDate);
    // next 1min
    setTimeout(iterator, process.env.POLLING_INTERVAL_SEC * 1000);
  };
  getDiscourse().then(nextRun, nextRun);
}

export default function () {}

export function startDaemon() {
  // start
  iterator();
}
