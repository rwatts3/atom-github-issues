'use babel';

var github = require('./github');

var marked = require('marked');
var React  = require('react');
var ReactDOM = require('react-dom');

var repo_path           = null; // path of the click event
var github_credentials  = {};
var labels              = null;
var available_assignees = null; // list of available assignees
var api_base            = null; // https://api.github.com/repos/:owner/:repo
var github_repo         = null; // api returned github repo
var atom_git_repo       = null; // Atom GitRepository
var parent_elem         = null; // parent DOM element

import TetherComponent from 'react-tether';

export default class GithubView {

    constructor(path) {
        repo_path          = path;
        atom_git_repo      = this.getGitRepository(repo_path); // get Atom's GitRepository object
        api_base           = 'https://api.github.com/repos/' + this.getOwnerRepo( atom_git_repo.getOriginURL() );

        // github.get(github_credentials.username, github_credentials.token, 'https://api.github.com/rate_limit').then(log);

        // Create root element
        parent_elem = document.createElement('div');
        parent_elem.className = 'atom-github-issues';

        this.initConnection();

    }
    initConnection(){
        var init_promises = [
            github.get(github_credentials.username, github_credentials.token, api_base),
            github.get(github_credentials.username, github_credentials.token, api_base + '/labels'),
            github.get(github_credentials.username, github_credentials.token, api_base + '/assignees')
        ];
        return Promise.all(init_promises).then((function(api_responses){
            if(api_responses[0].message === 'Not Found'){

                github_credentials = this.githubCredentials(atom_git_repo);
                return this.initConnection();

            }
            if(api_responses[0].message === 'Bad credentials'){
                // repo was not found but access token is not set so alert them to 'git config user.accesstoken "GITHUB_ACCESS_TOKEN"' and retry
                atom.notifications.addError('This repository is "Not Found". If this is a Private repository, add a Github Access Token by running \'git config user.accesstoken "GITHUB_ACCESS_TOKEN"\' and retry', {dismissable: true});
                return;
            }
            github_repo            = api_responses[0];
            labels                 = api_responses[1];
            available_assignees    = api_responses[2];

            this.renderView();

        }).bind(this))
    }
    // Tear down any state and detach
    destroy() {
        parent_elem.remove();
    }

    getElement() {
        return parent_elem;
    }

    getTitle(){
        return 'Github: ' + this.getRepo( atom_git_repo.getOriginURL() );
    }
    // get github credentials from the config
    githubCredentials(repo){
        return {
            username: repo.getConfigValue('user.name'),
            token: repo.getConfigValue('user.accesstoken')
        }
    }

    // get the GitRepository object for path
    getGitRepository(path){
    	try{
            var repos = atom.project.getRepositories();

            for(var i in repos){
                var repo_path_minus_dot_git = repos[i].path.split('/').slice(-2)[0];
                var path_parts = path.split('/');
                for(var x in path_parts){
                    if(repo_path_minus_dot_git === path_parts[x])
                        return repos[i];
                }
            }
            return repos[0];
    	} catch(e){
    		throw 'Repo not found for: ' + path;
    		return false;
    	 }

    }
    // takes in the originURL()
    // removes https://github.com/:owner/---.git from https://github.com/:owner/:repo.git
    // returns {String} of form :repo
     getRepo(url){
        var removed_api_url = url.split('/').slice(-1)[0];
        return removed_api_url.substring(0, removed_api_url.length - '.git'.length);
    }
    // takes in the originURL()
    // removes https://github.com/---.git from https://github.com/:owner/:repo.git
    // returns {String} of form :owner/:repo
    getOwnerRepo(url){
        var removed_api_url = url.split('/').slice(-2).join('/');
        return removed_api_url.substring(0, removed_api_url.length - '.git'.length);
    }
    renderView(){
        var container = document.createElement('div');
        ReactDOM.render(
            <Issues />,
            container
        );
        parent_elem.appendChild(container);
    }
}

class Issues extends React.Component {
    constructor() {
        super();
        this.loadIssues = this.loadIssues.bind(this);
    }
    getInitialState() {
        return {issues: []};
    }
    componentDidMount(){
        this.loadIssues();
    }
    loadIssues(){
        github.get(github_credentials.username, github_credentials.token, api_base + '/issues').then((function(issues){
            this.setState({issues: issues});
        }).bind(this))
    }
    render() {
        if(!this.state)
            return <div>loading issues from Github...</div>;

        var issues = this.state.issues;

        if(issues.message)
            return <div>{issues.message}</div>;

        return (
            <div>
                {issues.map(function(issue){
                    return <Issue issue={issue} />;
                })}
            </div>
        );
    }
};
class Issue extends React.Component {
    constructor() {
        // can't access this.props in constructor
        super();
        this.toggleComments = this.toggleComments.bind(this);
        this.reloadIssue = this.reloadIssue.bind(this);
        this.state = {
            show_comments: false
        }

    }
    reloadIssue(){
        github.get(github_credentials.username, github_credentials.token, this.props.issue.url).then((function(issue){
            this.setState({issue: issue});
        }).bind(this))
    }
    toggleComments() {
        this.setState({show_comments: !this.state.show_comments});
    }
    render() {
        var issue = this.props.issue;
        var comments_style = {display: 'none'};

        if(this.state.issue)
            issue = this.state.issue;

        if(this.state.show_comments)
            comments_style.display = 'block';

        return (
            <div className="github-issue-container">
                <div>
                    <Assignees issue={issue} reloadIssue={this.reloadIssue}/>
                    <h2 onClick={this.toggleComments}  className="github-issue-title cursor-default">{issue.title}</h2>
                    <span onClick={this.toggleComments} className='cursor-default'>comments: {issue.comments}</span>
                    <span onClick={this.getComments} className="icon icon-sync cursor-default"></span>
                    <Labels labels={issue.labels} issue={issue} />
                    <div style={comments_style}>
                        <Comment comment={issue} />
                        <Comments issue={issue} />
                        <NewComment issue={issue} reloadIssue={this.reloadIssue}/>
                    </div>
                </div>
            </div>
        );
    }
};

class Assignees extends React.Component {
    constructor() {
        super();
        this.destroyModal = this.destroyModal.bind(this);
        this.state = {
            modal_open: false
        };
    }
    routeAssignee(){
        var assignees = this.props.issue.assignees;
        var html_string = '';

        if(assignees.length === 0)
            html_string = '<span class="icon icon-person"></span>';
        else if(assignees.length === 1)
            html_string = '<img src="'+assignees[0].avatar_url+'"/>';

        else if(assignees.length === 2){
            html_string = '<div class="assignee-2-1" style="background-image: url('+assignees[0].avatar_url+');"></div>';
            html_string += '<div class="assignee-2-1" style="background-image: url('+assignees[1].avatar_url+');"></div>';
        }

        return {__html: html_string};
    }

    destroyModal(){
        this.setState({modal_open: !this.state.modal_open});
    }
    render() {

        const modal_open = this.state.modal_open;

        return (
            <TetherComponent
                attachment="top right"
                constraints={[{
                    to: 'scrollParent',
                    attachment: 'together'
                }]}
            >
            { /* First child: This is what the item will be tethered to */ }
            <div className='github-assignee-square' dangerouslySetInnerHTML={this.routeAssignee()} onClick={() => {this.setState({modal_open: !modal_open})}} />
            { /* Second child: If present, this item will be tethered to the the first child */ }
            {
                modal_open &&
                <div>
                    <AssigneeModal issue={this.props.issue} destroyModal={this.destroyModal} reloadIssue={this.props.reloadIssue}/>
                </div>
            }
            </TetherComponent>

        );
    }
};
class AssigneeModal extends React.Component {
    constructor() {
        super();
        this.handleChange = this.handleChange.bind(this);
    }
    isAssignee(assignee_id){ // passes in the available_assignees ids
        for(var i in this.props.issue.assignees){
            if(this.props.issue.assignees[i].id === assignee_id)
                return true;
        }
        return false;
    }
    handleChange(e){
        e.stopPropagation();

        var action = 'post';
        if(e.target.checked === false)
            action = 'delete';
        var endpoint = api_base + '/issues/' + this.props.issue.number + '/assignees';
        var data = {
            assignees: [e.target.dataset.login]
        };
        github[action](github_credentials.username, github_credentials.token, endpoint, data).then((function(response_body){
            this.props.reloadIssue();
        }).bind(this))
    }
    render() {
        var issue = this.props.issue;

        return (
            <div className='relative'>
                <span className='icon icon-x' onClick={this.props.destroyModal}></span>
                {available_assignees.map((function(assignee){
                    if(this.isAssignee(assignee.id))
                        return <div><input type='checkbox' onChange={this.handleChange} data-login={assignee.login} checked/>{assignee.login}</div>

                    return <div><input type='checkbox' onChange={this.handleChange} data-login={assignee.login} />{assignee.login}</div>
                }).bind(this))}
            </div>
        );
    }
};

class Labels extends React.Component {
    constructor() {
        super();
        this.toggleLabel = this.toggleLabel.bind(this);
    }
    activeLabel(label){
        for(var i in this.props.labels){
            if(this.props.labels[i].name === label)
                return true;
        }
        return false;
    }
    toggleLabel(e){
        var elem = e.target;
        if(elem.classList.contains('off')){
            github.post(github_credentials.username, github_credentials.token, api_base + '/issues/' + this.props.issue.number + '/labels', [elem.innerHTML] ).then(function(response_body){
                elem.classList.toggle('off');
            })
        }
        else {
            var endpoint = api_base + '/issues/' + this.props.issue.number + '/labels/' + elem.innerHTML;
            github.delete(github_credentials.username, github_credentials.token, endpoint).then(function(response_body){
                elem.classList.toggle('off');
            })
        }
    }
    render() {

        return (
            <div>
            {labels.map((function(label) {
                var span_style = {
                    backgroundColor: '#'+label.color,
                    borderBottomColor: adjustColor('#'+label.color, -0.2)
                }
                var class_name = 'label cursor-default';

                if(!this.activeLabel(label.name)){
                    class_name += ' off';
                }

                return <span onClick={this.toggleLabel} className={class_name} style={span_style}>{label.name}</span>;

            }).bind(this))}
            </div>
        );
    }
};
class Comments extends React.Component {
    constructor() {
        super();
        this.loadComments = this.loadComments.bind(this);
    }
    getInitialState() {
        return {comments: []};
    }
    componentDidMount(){
        this.loadComments();
    }
    componentWillReceiveProps(){
        this.loadComments();
    }
    loadComments(){
        github.get(github_credentials.username, github_credentials.token, this.props.issue.comments_url).then((function(comments){
            this.setState({comments: comments});
        }).bind(this))
    }
    render() {

        if(!this.state)
            return <div>loading comments from Github...</div>;

        var comments = this.state.comments;

        return (
            <div>
                {comments.map(function(comment){
                    return <Comment comment={comment} />;
                })}
            </div>
        );
    }
};
class Comment extends React.Component {
    constructor() {
        super();
    }
    render() {
        var comment = this.props.comment;
        return (
            <div className="github-comment-container">
                <h4>
                    <img className="avatar" src={comment.user.avatar_url} />
                    {comment.user.login}
                </h4>
                <div className="github-comment-body" dangerouslySetInnerHTML={createMarkup(comment.body)} />
            </div>
        );
    }
};

class NewComment extends React.Component {
    constructor() {
        // can't access this.props in constructor
        super();
        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleChange = this.handleChange.bind(this);

        this.state = {
            comment: ''
        };
    }

    handleChange(e){
        var update = [];
        update[e.target.name] = e.target.value;
        this.setState(update);
    }
    handleSubmit(e) {
        var form = e.target;

        var api_endpoint = this.props.issue.repository_url + '/issues' + '/' + this.props.issue.number + '/comments';

        github.post(github_credentials.username, github_credentials.token, api_endpoint, {body: form.comment.value}).then((function(response_body){
            this.setState({comment: ''});
            this.props.reloadIssue();
        }).bind(this))
    }

    render() {
        return (
            <div className="github-new-comment">
                <form onSubmit={this.handleSubmit}>
                    <textarea className='native-key-bindings' name='comment' placeholder='add comment' value={this.state.comment} onChange={this.handleChange}></textarea>
                    <button type='submit'>Comment</button>
                </form>
            </div>
        );
    }
};
function createMarkup(markdown){
    var returned_html = marked(markdown);
    if(returned_html.length === 0)
        returned_html = '<span>No description</span>';
    return {
        __html: returned_html
    }
}
function adjustColor(hex, lum) {

	// validate hex string
	hex = String(hex).replace(/[^0-9a-f]/gi, '');
	if (hex.length < 6) {
		hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
	}
	lum = lum || 0;

	// convert to decimal and change luminosity
	var rgb = "#", c, i;
	for (i = 0; i < 3; i++) {
		c = parseInt(hex.substr(i*2,2), 16);
		c = Math.round(Math.min(Math.max(0, c + (c * lum)), 255)).toString(16);
		rgb += ("00"+c).substr(c.length);
	}

	return rgb;
}

function on(node, type, callback) {

	// create event
	node.addEventListener(type, function(e) {
		// call handler
		return callback(e);
	});

}
// create a one-time event
function once(node, type, callback) {

	// create event
	node.addEventListener(type, function(e) {
		// remove event
		e.target.removeEventListener(e.type, arguments.callee);
		// call handler
		return callback(e);
	});

}
function log(a){ console.log(a); }